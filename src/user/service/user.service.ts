import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateUserDto } from '../dto/update-user.dto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { S3_CLIENT } from '../../provider/s3.provider';
import { REDIS_CLIENT } from '../../provider/redis.provider';
import { Redis } from 'ioredis';
import { getMimeType } from 'utils/image';

@Injectable()
export class UserService {
  private readonly logger = new Logger('UserService');

  constructor(
    @Inject(S3_CLIENT) private readonly s3: S3Client,
    @Inject(REDIS_CLIENT) private cache: Redis,
    private readonly prisma: PrismaService,
  ) {}

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

  async updateProfilePicture(user: User, file: string) {
    const type = getMimeType(file);
    if (type !== 'image/jpg' && type !== 'image/jpeg' && type !== 'image/png') {
      throw new BadRequestException('Only jpg, jpeg and png are accepted');
    }

    const buf = Buffer.from(
      file.replace(/^data:image\/\w+;base64,/, ''),
      'base64',
    );

    const putObjectRequest = new PutObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: `profile-pictures/${user.id}`,
      Body: buf,
      ContentType: type,
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
      throw new InternalServerErrorException(
        'Failed to upload profile picture',
      );
    }
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
}
