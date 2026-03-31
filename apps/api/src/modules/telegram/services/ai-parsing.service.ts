import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { z } from 'zod';

const parseSchema = z.object({
  type: z.enum(['income', 'expense']).nullable(),
  amount: z.number().positive().nullable(),
  occurredAt: z.string().min(1).nullable(),
  categoryCandidate: z.string().min(1).nullable(),
  comment: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  ambiguities: z.array(z.string()),
  followUpQuestion: z.string().nullable(),
  resolvedCurrency: z.string().min(3).max(3).nullable(),
});

export type ParsedTransaction = z.infer<typeof parseSchema>;

export type ParseRequest = {
  model: string;
  systemPrompt: string;
  clarificationPrompt?: string;
  categories: string[];
  householdCurrency: string;
  currentDate: string;
  userInput: string;
  conversationContext?: Array<{ role: 'assistant' | 'user'; text: string }>;
  imageDataUrl?: string;
};

@Injectable()
export class AiParsingService {
  private readonly client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      apiKey: process.env.POLZA_API_KEY,
      baseURL: process.env.POLZA_BASE_URL ?? 'https://polza.ai/api/v1',
    });
  }

  async parseTransaction(request: ParseRequest): Promise<ParsedTransaction> {
    const completion = await this.client.chat.completions.create({
      model: request.model,
      messages: this.buildMessages(request),
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'transaction_parse',
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              type: { type: ['string', 'null'], enum: ['income', 'expense', null] },
              amount: { type: ['number', 'null'] },
              occurredAt: { type: ['string', 'null'] },
              categoryCandidate: { type: ['string', 'null'] },
              comment: { type: ['string', 'null'] },
              confidence: { type: 'number' },
              ambiguities: { type: 'array', items: { type: 'string' } },
              followUpQuestion: { type: ['string', 'null'] },
              resolvedCurrency: { type: ['string', 'null'] },
            },
            required: [
              'type',
              'amount',
              'occurredAt',
              'categoryCandidate',
              'comment',
              'confidence',
              'ambiguities',
              'followUpQuestion',
              'resolvedCurrency',
            ],
          },
        },
      },
    });

    return parseSchema.parse(
      JSON.parse(completion.choices[0]?.message?.content ?? '{}'),
    );
  }

  private buildMessages(request: ParseRequest) {
    const baseContext = [
      `Текущая дата: ${request.currentDate}.`,
      `Базовая валюта household: ${request.householdCurrency}.`,
      `Доступные категории: ${request.categories.join(', ') || 'нет категорий'}.`,
      'Правила: categoryCandidate должен быть только одним точным значением из списка доступных категорий или null.',
      'Нельзя придумывать новые категории, merchant names, синонимы или значения вне списка.',
      'Если дата не указана явно, верни текущую дату из поля currentDate.',
    ].join('\n');

    const history = request.conversationContext?.length
      ? request.conversationContext
          .map((item, index) => `${index + 1}. ${item.role}: ${item.text}`)
          .join('\n')
      : 'Нет истории уточнения.';

    const userText = [
      baseContext,
      '',
      request.clarificationPrompt
        ? `Контекст clarification:\n${request.clarificationPrompt}`
        : null,
      '',
      `История диалога:\n${history}`,
      '',
      `Текущее сообщение пользователя:\n${request.userInput}`,
    ]
      .filter(Boolean)
      .join('\n');

    if (request.imageDataUrl) {
      return [
        {
          role: 'system' as const,
          content: request.systemPrompt,
        },
        {
          role: 'user' as const,
          content: [
            {
              type: 'text',
              text: userText,
            },
            {
              type: 'image_url',
              image_url: {
                url: request.imageDataUrl,
                detail: 'auto',
              },
            },
          ],
        } as any,
      ];
    }

    return [
      {
        role: 'system' as const,
        content: request.systemPrompt,
      },
      {
        role: 'user' as const,
        content: userText,
      },
    ];
  }
}
