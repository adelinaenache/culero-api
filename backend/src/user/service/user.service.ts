import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RatingDto } from '../dto/rating.dto';
import { UpdateUserDto } from '../dto/update-user.dto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

@Injectable()
export class UserService {
  private readonly s3 = new S3Client({
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
    region: process.env.AWS_REGION,
  });

  private readonly logger = new Logger('UserService');

  constructor(private readonly prisma: PrismaService) {}

  async getSelf(user: User) {
    return user;
  }

  async updateSelf(user: User, dto: UpdateUserDto) {
    return await this.prisma.user.update({
      where: { id: user.id },
      data: {
        name: dto.name,
        headline: dto.headline,
      },
    });
  }

  async updateProfilePicture(user: User, file: Express.Multer.File) {
    const putObjectRequest = new PutObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: `profile-pictures/${user.id}`,
      Body: file.buffer,
      ContentType: file.mimetype,
    });

    try {
      await this.s3.send(putObjectRequest);
      this.logger.log('Profile picture uploaded');

      return await this.prisma.user.update({
        where: { id: user.id },
        data: {
          profilePictureUrl: `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/profile-pictures/${user.id}`,
        },
      });
    } catch (err) {
      this.logger.error(err);
      throw new InternalServerErrorException(
        'Failed to upload profile picture',
      );
    }
  }

  async rateUser(user: User, ratedUserId: User['id'], rating: RatingDto) {
    const ratedUser = await this.prisma.user.findUnique({
      where: { id: ratedUserId },
    });

    // Check if the user exists
    if (!ratedUser) {
      throw new NotFoundException('User not found');
    }

    // Check if the user is trying to rate himself
    if (user.id === ratedUserId) {
      throw new BadRequestException('You cannot rate yourself');
    }

    // Rate the user
    await this.prisma.rating.create({
      data: {
        ratedUserId: ratedUserId,
        raterUserId: rating.anonymous ? null : user.id,
        professionalism: rating.professionalism,
        reliability: rating.reliability,
        communication: rating.communication,
        comment: rating.comment,
        anonymous: rating.anonymous,
      },
    });
  }

  async getUserReviews(user: User, self: boolean, revieweeUserId?: User['id']) {
    if (self) revieweeUserId = user.id;
    const revieweeUser = await this.prisma.user.findUnique({
      where: { id: revieweeUserId },
      include: {
        receivedReviews: {
          include: {
            author: true,
          },
        },
      },
    });

    if (!revieweeUser) {
      throw new NotFoundException('User not found');
    }

    return revieweeUser.receivedReviews.map((review) => ({
      userName: review.author.name,
      profilePictureUrl: review.author.profilePictureUrl ?? '',
      professionalism: review.professionalism,
      reliability: review.reliability,
      communication: review.communication,
      createdOn: review.createdAt.toISOString(),
      comment: !self ? review.comment : undefined,
    }));
  }

  async searchUsers(searchTerm?: string) {
    if (!searchTerm) {
      throw new BadRequestException('Search term is required');
    }
    const users = await this.prisma.user.findMany({
      where: {
        OR: [
          { email: { contains: searchTerm } },
          { name: { contains: searchTerm } },
        ],
      },
      select: {
        id: true,
        email: true,
        name: true,
        profilePictureUrl: true,
      },
    });
    return users;
  }

  async linkSocialAccount(
    userId: string,
    provider: string,
    accessToken: string,
  ) {
    const user = await this.findUserById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    let email: string | undefined;

    const existingUser = await this.findUserByEmail(email);
    if (existingUser && existingUser.id !== user.id) {
      throw new ConflictException(
        'Social account already linked to a different user',
      );
    }

    // Add the social account to the user
    await this.prisma.linkedSocialAccount.create({
      data: {
        platform: provider,
        accessToken,
        userId,
      },
    });

    return user;
  }

  private async findUserById(id: string) {
    return await this.prisma.user.findUnique({ where: { id } });
  }

  private async findUserByEmail(email: string) {
    return await this.prisma.user.findUnique({
      where: {
        email,
      },
    });
  }

  async getUserRatings(user: User, self: boolean, userId?: User['id']) {
    if (self) userId = user.id;

    const UserData = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!UserData) {
      throw new Error('User not found');
    }
    
    const result = await this.prisma.rating.aggregate({
      where: { ratedUserId: userId },
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
      overall: (
        (result._avg.professionalism ?? 0) +
        (result._avg.reliability ?? 0) +
        (result._avg.communication ?? 0)
      ) / 3,
    }; 
  }  
}
