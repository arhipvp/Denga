import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { getApiRuntimeConfig } from '../common/runtime-config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    const runtimeConfig = getApiRuntimeConfig();
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: runtimeConfig.jwtSecret,
    });
  }

  validate(payload: { sub: string; email: string; role: string }) {
    return payload;
  }
}
