import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import { CurrentUser } from '../../decorators/current-user.decorator';
import { UserService } from '../service/user.service';
import { User } from '@prisma/client';
import { UpdateUserDto } from '../dto/update-user.dto';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { userProperties } from '../../schemas/user.properties';

import { Public } from '../../decorators/public.decorator';

@Controller('user')
@ApiBearerAuth()
@ApiTags('User Controller')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get()
  @ApiOperation({
    summary: 'Get current user',
    description: 'Get the currently logged in user',
  })
  @ApiOkResponse({
    description: 'Current user found',
    schema: {
      type: 'object',
      properties: userProperties,
    },
  })
  async getCurrentUser(@CurrentUser() user: User) {
    return this.userService.getSelf(user);
  }

  @Put()
  @ApiOperation({
    summary: 'Update current user',
    description: 'Update the currently logged in user',
  })
  @ApiOkResponse({
    description: 'User updated',
    schema: {
      type: 'object',
      properties: userProperties,
    },
  })
  async updateCurrentUser(
    @CurrentUser() user: User,
    @Body() dto: UpdateUserDto,
  ) {
    return this.userService.updateSelf(user, dto);
  }

  @Put('/profile-picture')
  @ApiOperation({
    summary: 'Upload profile picture encoded in base64',
    description: 'Upload a new profile picture',
  })
  @ApiOkResponse({
    description: 'Profile picture uploaded',
    schema: {
      type: 'object',
      properties: userProperties,
    },
  })
  @ApiInternalServerErrorResponse({
    description: 'Failed to upload profile picture',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
        },
      },
    },
  })
  async uploadFile(@CurrentUser() user: User, @Body('file') file: string) {
    return this.userService.updateProfilePicture(user, file);
  }

  @Public()
  @Post('/link-social')
  @ApiOperation({
    summary: 'Link social account',
    description: 'Link a social account to the currently logged in user',
  })
  @ApiBadRequestResponse({
    description: 'Invalid social account',
  })
  @ApiConflictResponse({
    description: 'Social account already linked',
  })
  @ApiCreatedResponse({
    description: 'Social account linked successfully',
  })
  async linkSocialAccount(
    @Body()
    {
      userId,
      provider,
      accessToken,
    }: {
      userId: string;
      provider: string;
      accessToken: string;
    },
  ) {
    await this.userService.linkSocialAccount(userId, provider, accessToken);
  }
}
