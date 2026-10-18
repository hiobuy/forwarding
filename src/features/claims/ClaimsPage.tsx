import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PackageSearch } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { formatDate } from "../../domain/dates";
import { Button, Card, ConfirmDialog, Dimensions, EmptyState, ErrorState, LoadingBlock, PageHeader, PhotoGallery, StatusBadge, Weight } from "../../components/ui";
import { useToast } from "../../components/toast";
import { ApiError, api } from "../../lib/api";
import type { ClaimItem, PackageItem } from "../../types/api";

export function ClaimsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [claimId, setClaimId] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const query = useQuery({ queryKey: ["claims"], queryFn: () => api<ClaimItem[]>("/api/claims") });
  const onError = (reason: unknown) => toast({ title: reason instanceof ApiError ? reason.message : "Something went wrong. Try again.", tone: "danger" });
  const confirm = useMutation({
    mutationFn: (id: string) => api<PackageItem>(`/api/claims/${id}/confirm`, { method: "POST" }),
    onSuccess: async (pkg) => {
      await queryClient.invalidateQueries({ queryKey: ["claims"] });
      await queryClient.invalidateQueries({ queryKey: ["packages"] });
      await queryClient.invalidateQueries({ queryKey: ["nav"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast({ title: `Claimed. It's now ${pkg.publicId} in your packages.`, tone: "success" });
      navigate(`/app/packages/${pkg.id}`);
    },
    onError,
  });
  const reject = useMutation({
    mutationFn: (id: string) => api(`/api/claims/${id}/reject`, { method: "POST" }),
    onSuccess: async () => {
      setRejectId(null);
      await queryClient.invalidateQueries({ queryKey: ["claims"] });
      await queryClient.invalidateQueries({ queryKey: ["nav"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast({ title: "Marked as not yours. It's removed from this list.", tone: "success" });
    },
    onError,
  });

  return (
    <div>
      <PageHeader title="Claim packages" subtitle="These parcels arrived without a matching package or member code. Check the photos and claim the ones that are yours." />
      {query.isLoading ? <LoadingBlock rows={2} /> : null}
      {query.error ? <ErrorState message="Could not load parcels to claim." onRetry={() => void query.refetch()} /> : null}
      {query.data && query.data.length === 0 ? (
        <EmptyState icon={PackageSearch} title="Nothing to claim" body="When the warehouse can't match a parcel to an account, it shows up here for you to check." action={<Button variant="secondary" to="/app/packages">View packages</Button>} />
      ) : null}
      <div className="space-y-4">
        {query.data?.map((item) => (
          <Card key={item.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <StatusBadge label="Waiting for claim" tone="warning" />
                <h2 className="mt-2 font-mono text-lg font-semibold tracking-tight">{item.domesticTrackingNumber}</h2>
                <p className="mt-0.5 text-[13px] text-slate-500">
                  {item.courier} · Received {formatDate(item.receivedAt)}
                </p>
              </div>
              <dl className="flex gap-2 text-[13px]">
                <div className="rounded-lg bg-slate-50 px-3 py-2">
                  <dt className="text-[12px] text-slate-500">Weight</dt>
                  <dd className="font-semibold"><Weight grams={item.weightGrams} /></dd>
                </div>
                <div className="rounded-lg bg-slate-50 px-3 py-2">
                  <dt className="text-[12px] text-slate-500">Size</dt>
                  <dd className="font-semibold">{item.lengthMm && item.widthMm && item.heightMm ? <Dimensions length={item.lengthMm} width={item.widthMm} height={item.heightMm} /> : "Not measured"}</dd>
                </div>
              </dl>
            </div>
            <div className="mt-4">
              <PhotoGallery photos={item.photos} />
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
              <p className="text-[13px] text-slate-500">Once claimed, it moves into your packages and can be shipped.</p>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setRejectId(item.id)}>
                  Not mine
                </Button>
                <Button onClick={() => setClaimId(item.id)}>Claim this package</Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
      <ConfirmDialog
        open={claimId != null}
        title="Claim this package?"
        body="Only claim parcels you ordered. It will be added to your packages under your member code."
        confirmLabel="Claim package"
        pending={confirm.isPending}
        onClose={() => setClaimId(null)}
        onConfirm={() => claimId && confirm.mutate(claimId)}
      />
      <ConfirmDialog
        open={rejectId != null}
        title="Not your package?"
        body="It will be removed from your list so the warehouse can match it to its owner."
        confirmLabel="Not mine"
        pending={reject.isPending}
        onClose={() => setRejectId(null)}
        onConfirm={() => rejectId && reject.mutate(rejectId)}
      />
    </div>
  );
}
