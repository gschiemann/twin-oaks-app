// The one seam the rest of the app is meant to call into.
//
// When the owner taps "Add it as a new expense" on a bank transaction, the
// expense form opens with `?fromBankTxn=<id>`. Whoever creates that expense
// (src/app/expenses/actions.ts — owned by another engineer) calls
// attachExpenseToBankTransaction() afterwards so the transaction stops
// asking to be reviewed.
//
// Contract, on purpose:
//  - plain async functions, NOT server actions, so any server module can
//    import them;
//  - accountId-scoped on BOTH sides — a forged id links nothing;
//  - they NEVER throw. A bookkeeping link failing must not take down the
//    save that just succeeded.
//  - they only ever write to BankTransaction. This module never creates,
//    edits or deletes an Expense or an Income.

import { prisma } from "@/lib/db";

async function attach(
  accountId: string,
  bankTxnId: string,
  data: { matchedExpenseId: string | null; matchedIncomeId: string | null },
): Promise<boolean> {
  try {
    const txn = await prisma.bankTransaction.findFirst({
      where: { id: bankTxnId, accountId },
      select: { id: true },
    });
    if (!txn) return false;
    await prisma.bankTransaction.updateMany({
      where: { id: bankTxnId, accountId },
      data: { status: "MATCHED", ...data },
    });
    return true;
  } catch {
    // Never let a link failure break the caller's save.
    return false;
  }
}

/** Mark a bank transaction as matched to an expense. Returns false (quietly)
 *  if either record isn't this account's. */
export async function attachExpenseToBankTransaction(
  accountId: string,
  bankTxnId: string | null | undefined,
  expenseId: string | null | undefined,
): Promise<boolean> {
  if (!accountId || !bankTxnId || !expenseId) return false;
  try {
    const expense = await prisma.expense.findFirst({
      where: { id: expenseId, accountId },
      select: { id: true },
    });
    if (!expense) return false;
  } catch {
    return false;
  }
  return attach(accountId, bankTxnId, { matchedExpenseId: expenseId, matchedIncomeId: null });
}

/** Same, for money coming in. */
export async function attachIncomeToBankTransaction(
  accountId: string,
  bankTxnId: string | null | undefined,
  incomeId: string | null | undefined,
): Promise<boolean> {
  if (!accountId || !bankTxnId || !incomeId) return false;
  try {
    const income = await prisma.income.findFirst({
      where: { id: incomeId, accountId },
      select: { id: true },
    });
    if (!income) return false;
  } catch {
    return false;
  }
  return attach(accountId, bankTxnId, { matchedExpenseId: null, matchedIncomeId: incomeId });
}
