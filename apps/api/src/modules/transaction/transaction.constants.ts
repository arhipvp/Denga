export const transactionDetailInclude = {
  category: true,
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
} as const;
