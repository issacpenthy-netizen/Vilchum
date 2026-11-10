import { randomUUID } from "node:crypto";
export type PayoutMethod = "ABA" | "ACLEDA" | "VISA";

export interface PayoutProvider {
  pay(amount: number, account: string): Promise<{ providerRef: string }>;
}
class SandboxProvider implements PayoutProvider {
  constructor(private readonly method: PayoutMethod) {}
  async pay(_amount: number, _account: string) {
    // TODO: replace sandbox simulation with a contracted bank API and credentials.
    await new Promise((resolve) => setTimeout(resolve, 3000));
    return { providerRef: `SANDBOX-${this.method}-${randomUUID().slice(0, 8).toUpperCase()}` };
  }
}
export const payoutProviders: Record<PayoutMethod, PayoutProvider> = {
  ABA: new SandboxProvider("ABA"), ACLEDA: new SandboxProvider("ACLEDA"), VISA: new SandboxProvider("VISA"),
};
