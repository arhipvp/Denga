export const transactionDetailInclude = {
  category: {
    include: {
      parent: true,
    },
  },
  author: true,
  sourceMessage: {
    include: {
      attachments: true,
      clarificationSession: true,
      reviewDraft: true,
      parseAttempts: {
        orderBy: {
          createdAt: 'desc',
        },
      },
    },
  },
} as const satisfies Record<string, unknown>;
