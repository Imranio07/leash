import type { Metadata } from "next";
import ClientVaultPage from "@/components/ClientVaultPage";

export const metadata: Metadata = {
  title: "Leash · vault",
  description: "Read-only view of a Leash vault on Solana devnet: its rules, balance and every payment and rejection.",
};

export default async function Page({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  return <ClientVaultPage address={address} />;
}
