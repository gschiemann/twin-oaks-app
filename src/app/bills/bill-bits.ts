// Shared bits for the bills screens.
//
// The plain-English reason a save was refused. Both the add and the edit
// screen read from here so the operator never sees two different wordings
// for the same problem — and never sees a word like "validation".
export const BILL_ERRORS: Record<string, string> = {
  missing: "Give the bill a name, pick a category, and try again.",
  amount: "Enter how much the bill is — a number bigger than zero, like 184.50.",
};

export function billErrorText(code: string | undefined): string {
  return (code && BILL_ERRORS[code]) || BILL_ERRORS.missing;
}
