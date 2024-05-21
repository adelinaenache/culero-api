import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { User, Review, FavoriteReview } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { ReviewDto } from './DTO/reviews.dto';
import { REDIS_CLIENT } from 'src/provider/redis.provider';
import Redis from 'ioredis';
import { CreateReviewDto } from './DTO/create-review.dto';
import { RatingDto } from './DTO/rating.dto';

@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private cache: Redis,
  ) {}

  // transform a review from the DB to ReviewDTO (as expected by the API)
  private transformReview(
    review: Review & { postedBy: User } & { favorites: FavoriteReview[] },
    currentUserId: User['id'],
  ): ReviewDto {
    return {
      postedBy: !review.anonymous
        ? {
            id: review.postedBy.id,
            isEmailVerified: review.postedBy.isEmailVerified,
            profilePictureUrl: review.postedBy.profilePictureUrl,
            name: review.postedBy.name,
          }
        : undefined,
      isAnonymous: !review.postedBy,
      professionalism: review.professionalism,
      reliability: review.reliability,
      communication: review.communication,
      comment: review.comment,
      createdAt: review.createdAt,
      isOwnReview: review.postedById == currentUserId,
      postedToId: review.postedToId,
      id: review.id,
      isFavorite: !!review.favorites.find((f) => f.userId === currentUserId),
      state: review.state,
    };
  }

  // properties to include with the review. Based on the userId to calculate if review is favorite by review.
  private includeWithReview(currentUserId: User['id']) {
    return {
      postedBy: true,
      favorites: {
        where: {
          userId: currentUserId,
        },
      },
    };
  }

  private async calculateAvgRating(userId: User['id']): Promise<RatingDto> {
    const result = await this.prisma.review.aggregate({
      where: { postedToId: userId },
      _avg: {
        professionalism: true,
        reliability: true,
        communication: true,
      },
    });

    return {
      professionalism: result._avg.professionalism ?? 0,
      reliability: result._avg.reliability ?? 0,
      communication: result._avg.communication ?? 0,
    };
  }

  async getUserReviews(user: User, postedToId: User['id']) {
    const ratings = await this.prisma.review.findMany({
      where: { postedToId: postedToId },
      include: this.includeWithReview(user.id),
      orderBy: {
        createdAt: 'desc',
      },
    });

    return ratings.map((review) => this.transformReview(review, user.id));
  }

  async createReview(
    user: User,
    postedToId: User['id'],
    ratingDto: CreateReviewDto,
  ) {
    const ratedUser = await this.prisma.user.findUnique({
      where: { id: postedToId },
    });

    // Check if the user exists
    if (!ratedUser) {
      throw new NotFoundException('User not found');
    }

    // Check if the user is trying to rate himself
    if (user.id === postedToId) {
      throw new BadRequestException('You cannot rate yourself');
    }

    ratingDto.anonymous = ratingDto.anonymous ?? false;

    // Rate the user
    const review = await this.prisma.review.create({
      data: {
        postedToId: postedToId,
        postedById: ratingDto.anonymous ? null : user.id,
        professionalism: ratingDto.professionalism,
        reliability: ratingDto.reliability,
        communication: ratingDto.communication,
        comment: ratingDto.comment,
        anonymous: ratingDto.anonymous,
      },
      include: this.includeWithReview(user.id),
    });

    // Update the cache
    const avgRatings = await this.calculateAvgRating(postedToId);
    await this.cache.set(
      `avg-ratings-${postedToId}`,
      JSON.stringify(avgRatings),
    );

    return this.transformReview(review, user.id);
  }

  async getAvgUserRatings(userId: User['id']) {
    // Check the cache first
    const cachedRatings = JSON.parse(
      await this.cache.get(`avg-ratings-${userId}`),
    );

    // If present, return the cached ratings
    if (cachedRatings) {
      return cachedRatings;
    }

    // If not, calculate the average ratings
    const avgRatings = await this.calculateAvgRating(userId);

    // Cache the ratings for 24 hours
    await this.cache.set(`avg-ratings-${userId}`, JSON.stringify(avgRatings));

    return avgRatings;
  }

  async getReview(userId: User['id'], reviewId: Review['id']) {
    return this.prisma.review.findUnique({
      where: {
        id: reviewId,
      },
      include: this.includeWithReview(userId),
    });
  }

  async likeReview(user: User, reviewId: Review['id']): Promise<ReviewDto> {
    this.prisma.favoriteReview.upsert({
      where: {
        userId_reviewId: {
          userId: user.id,
          reviewId: reviewId,
        },
      },
      update: {},
      create: {
        userId: user.id,
        reviewId: reviewId,
      },
    });
    const review = await this.getReview(user.id, reviewId);

    return this.transformReview(review, user.id);
  }

  async unlikeReview(user: User, reviewId: Review['id']): Promise<ReviewDto> {
    await this.prisma.favoriteReview.delete({
      where: {
        userId_reviewId: {
          userId: user.id,
          reviewId: reviewId,
        },
      },
    });

    const review = await this.getReview(user.id, reviewId);

    return this.transformReview(review, user.id);
  }
}