import { INSPECTION_SEAL, formatCzk } from "@/lib/copy";

export type OfferCardModel = {
  title: string;
  conditionLabel: string;
  originLabel: string | null;
  conditionDetail: string | null;
  oemNumber: string | null;
  priceCzk: number;
  deliveryLeadTime: string;
  badge?: string | null;
  imageUrl?: string | null;
};

export function OfferCard({ item }: { item: OfferCardModel }) {
  return (
    <article data-testid="offer-card" className="flex h-full flex-col overflow-hidden rounded-3xl border border-line bg-card">
      {item.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.imageUrl} alt="" className="h-40 w-full object-cover" />
      ) : (
        <div className="flex h-28 items-end bg-primary px-4 py-3 text-sm font-semibold text-white/80">Bez vlastní fotky</div>
      )}
      <div className="flex flex-1 flex-col gap-3 p-4">
        {item.badge ? (
          <p className="w-fit rounded-full bg-accent px-3 py-1 text-xs font-semibold uppercase tracking-wide text-primary">
            {item.badge}
          </p>
        ) : null}
        <h3 className="font-display text-xl font-semibold leading-tight">{item.title}</h3>
        <p className="text-sm font-semibold">
          {item.conditionLabel}
          {item.originLabel ? ` · ${item.originLabel}` : ""}
        </p>
        {item.conditionDetail ? <p className="text-sm leading-6 text-muted">{item.conditionDetail}</p> : null}
        {item.oemNumber ? (
          <p className="text-sm">
            <span className="text-muted">OEM </span>
            <span className="font-semibold">{item.oemNumber}</span>
          </p>
        ) : null}
        <p className="font-display text-2xl font-semibold">{formatCzk(item.priceCzk)}</p>
        <p className="text-sm leading-6">{item.deliveryLeadTime}</p>
        <p className="mt-auto rounded-2xl bg-primary px-3 py-2 text-sm font-semibold text-white">{INSPECTION_SEAL}</p>
      </div>
    </article>
  );
}
