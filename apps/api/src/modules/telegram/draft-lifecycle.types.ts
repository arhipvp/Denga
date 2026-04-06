export type DraftCreateResult = {
  accepted: true;
  status: 'pending_review';
};

export type DraftConfirmResult =
  | {
      accepted: true;
      status: 'missing_fields';
    }
  | {
      accepted: true;
      status: 'confirmed';
      transactionId: string;
    }
  | {
      accepted: true;
      status: 'invalid_category' | 'invalid_category_type';
    };

export type DraftCancelResult = {
  accepted: true;
  status: 'cancelled';
};

export type DraftReparseResult = {
  accepted: true;
  status: 'pending_review';
};

export type DraftActionResult =
  | DraftCreateResult
  | DraftConfirmResult
  | DraftCancelResult
  | DraftReparseResult;
