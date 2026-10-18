import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Wallet } from "lucide-react";
import { useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { Button, Card, ErrorState, LoadingBlock, Money, Notice, PageHeader, plural } from "../../components/ui";
import { ApiError, api, idempotencyKey } from "../../lib/api";
import type { Checkout } from "../../types/api";

export function CheckoutPage() {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const query = useQuery({ queryKey: ["checkout", id], queryFn: () => api<Checkout>(`/api/checkout/${id}`) });
  const options = useQuery({ queryKey: ["payment-options"], queryFn: () => api<{ stripe: boolean }>("/api/payments/options") });
  const card = useMutation({
    mutationFn: () => api<{ url: string | null }>(`/api/checkout/${id}/stripe`, { method: "POST" }),
    onSuccess: (result) => {
      if (result.url) window.location.assign(result.url);
      else setError("Card checkout did not start.");
    },
    onError: (reason) => setError(reason instanceof ApiError ? reason.message : "Card checkout did not start."),
  });
  const pay = useMutation({
    mutationFn: () => api<Checkout>(`/api/checkout/${id}/pay`, { method: "POST", headers: { "Idempotency-Key": idempotencyKey() } }),
    onSuccess: async (checkout) => {
      queryClient.setQueryData(["checkout", id], checkout);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["wallet"] }),
        queryClient.invalidateQueries({ queryKey: ["shipments"] }),
        queryClient.invalidateQueries({ queryKey: ["shipment"] }),
        queryClient.invalidateQueries({ queryKey: ["nav"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    },
    onError: async (reason) => {
      setError(reason instanceof ApiError ? reason.message : "Payment failed. Nothing was charged.");
      if (reason instanceof ApiError && reason.code === "CHECKOUT_CHANGED") await query.refetch();
    },
  });
  const checkout = query.data;
  if (query.isLoading) return <div className="mx-auto max-w-xl"><LoadingBlock label="Loading checkout" rows={3} /></div>;
  if (!checkout)
    return (
      <div className="mx-auto max-w-xl">
        <ErrorState message="This checkout could not be found. It may have expired." action={<Button variant="secondary" size="sm" to="/app/shipments?status=to_pay">Back to shipments</Button>} />
      </div>
    );

  if (checkout.status === "PAID") {
    return (
      <div className="mx-auto max-w-xl">
        <div className="dialog-panel rounded-2xl border border-slate-200/80 bg-white p-6 text-center shadow-[0_1px_2px_rgba(16,24,40,0.03)]">
          <span className="mx-auto grid size-12 place-items-center rounded-full bg-emerald-50 text-emerald-600">
            <CheckCircle2 size={26} aria-hidden="true" />
          </span>
          <h1 className="mt-4 text-xl font-semibold tracking-tight">Payment complete</h1>
          <p className="mt-1 text-[13px] text-slate-500">
            {plural(checkout.items.length, "shipment")} paid. They're released to the carrier on the next dispatch.
          </p>
          <div className="mt-3 text-3xl font-semibold tracking-tight">
            <Money fen={checkout.totalFen} />
          </div>
          <dl className="mt-5 divide-y divide-slate-100 border-y border-slate-100 text-left text-[13px]">
            {checkout.items.map((item) => (
              <div key={item.id} className="flex justify-between py-2">
                <dt className="text-slate-600">{item.label}</dt>
                <dd className="font-medium"><Money fen={item.amountFen} /></dd>
              </div>
            ))}
            <div className="flex justify-between py-2">
              <dt className="text-slate-600">Wallet balance now</dt>
              <dd className="font-medium"><Money fen={checkout.walletBalanceFen} /></dd>
            </div>
          </dl>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button to="/app/shipments">View shipments</Button>
            <Button variant="secondary" to="/app/dashboard">Back to dashboard</Button>
          </div>
        </div>
      </div>
    );
  }

  const short = checkout.walletBalanceFen < checkout.totalFen;
  const after = checkout.walletBalanceFen - checkout.totalFen;
  const topUpHref = `/app/wallet/top-up?return=/app/checkout/${checkout.id}&amount=${Math.ceil(checkout.amountNeededFen / 100)}`;

  return (
    <div className="mx-auto max-w-xl pb-28 md:pb-0">
      <PageHeader back={{ to: "/app/shipments?status=to_pay", label: "Shipments" }} title="Checkout" subtitle="Totals are calculated by the server. You pay from your wallet balance." />
      <Card className="p-0 sm:p-0">
        <dl className="divide-y divide-slate-100 px-4 sm:px-5">
          {checkout.items.map((item) => (
            <div key={item.id} className="flex justify-between gap-3 py-3 text-sm">
              <dt className="text-slate-700">{item.label}</dt>
              <dd className="font-medium"><Money fen={item.amountFen} /></dd>
            </div>
          ))}
        </dl>
        <div className="border-t border-slate-100 px-4 py-4 sm:px-5">
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-medium">Total</span>
            <span className="text-2xl font-semibold tracking-tight"><Money fen={checkout.totalFen} /></span>
          </div>
        </div>
        <div className="border-t border-slate-100 px-4 py-4 sm:px-5">
          <div className="flex items-center justify-between text-[13px]">
            <span className="inline-flex items-center gap-2 text-slate-600">
              <Wallet size={15} className="text-slate-400" aria-hidden="true" /> Wallet balance
            </span>
            <span className="font-medium"><Money fen={checkout.walletBalanceFen} /></span>
          </div>
          {!short ? (
            <div className="mt-1 flex justify-between text-[12px] text-slate-400">
              <span>After payment</span>
              <Money fen={after} />
            </div>
          ) : null}
          {error ? <div className="mt-4"><Notice tone="danger">{error}</Notice></div> : null}
          {short ? (
            <div className="mt-4">
              <Notice tone="warning">
                <strong className="block">Your wallet is <Money fen={checkout.amountNeededFen} /> short.</strong>
                Top up at least that amount, then come back here to pay.
              </Notice>
              <Button className="mt-3 hidden w-full md:inline-flex" size="lg" to={topUpHref}>
                Top up <Money fen={checkout.amountNeededFen} />
              </Button>
            </div>
          ) : (
            <Button className="mt-4 hidden w-full md:inline-flex" size="lg" loading={pay.isPending} onClick={() => pay.mutate()}>
              {pay.isPending ? "Paying…" : <>Pay <Money fen={checkout.totalFen} /> from wallet</>}
            </Button>
          )}
          {options.data?.stripe ? (
            <Button className="mt-2 hidden w-full md:inline-flex" size="lg" variant="secondary" loading={card.isPending} onClick={() => card.mutate()}>
              Pay with card
            </Button>
          ) : null}
        </div>
      </Card>
      <p className="mt-3 text-center text-[12px] text-slate-400">The total is checked again when you pay. If a shipment changed, this page refreshes with the new amount.</p>
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur md:hidden">
        {short ? (
          <Button className="w-full" size="lg" to={topUpHref}>
            Top up <Money fen={checkout.amountNeededFen} />
          </Button>
        ) : (
          <Button className="w-full" size="lg" loading={pay.isPending} onClick={() => pay.mutate()}>
            Pay from wallet
          </Button>
        )}
        {options.data?.stripe ? (
          <Button className="mt-2 w-full" size="lg" variant="secondary" loading={card.isPending} onClick={() => card.mutate()}>
            Pay with card
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function CheckoutReturnPage() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const sessionId = params.get("session_id") ?? "";
  const query = useQuery({
    queryKey: ["stripe-session", sessionId],
    queryFn: () => api<{ status: string }>(`/api/payments/stripe/session?session_id=${encodeURIComponent(sessionId)}`),
    enabled: Boolean(sessionId),
    refetchInterval: (current) => (current.state.data?.status === "pending" ? 2000 : false),
  });
  const status = query.data?.status ?? "pending";
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="Card payment" subtitle="This page only shows the result. The wallet and shipment update after the server confirms Stripe." />
      <Card>
        <div className="px-5 py-6 text-sm">
          {status === "paid" ? <p>Payment confirmed. Freight is paid. HioBuy fulfillment payment is tracked separately.</p> : null}
          {status === "failed" ? <p>The card payment was not applied.</p> : null}
          {status === "held" ? <p>The payment is held for review and is not available to spend yet.</p> : null}
          {status !== "paid" && status !== "failed" && status !== "held" ? <p>Waiting for Stripe to confirm this payment. You can leave this page.</p> : null}
          <Button className="mt-4" to={`/app/checkout/${id}`}>Back to checkout</Button>
        </div>
      </Card>
    </div>
  );
}
