import { Test } from '@nestjs/testing';
import { AppController } from '../src/modules/app.controller';

describe('AppController', () => {
  it('returns service info', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AppController],
    }).compile();

    const controller = moduleRef.get(AppController);
    expect(controller.getInfo()).toEqual({
      name: 'denga-api',
      status: 'ok',
    });
  });
});
