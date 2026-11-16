// What the profile cards share: the shapes of the answers from the server and the allowance bar.



export interface Usage {
  month: string;
  requests: number;
  costUsd: number;
  limitUsd: number | null;
}
export interface Me {
  user: { id: string; email: string; name: string; role: "admin" | "player"; owner: boolean };
  accounts: boolean;
  usage: Usage;
}
export interface Player {
  id: string;
  email: string;
  name: string;
  role: "admin" | "player";
  owner: boolean;
  disabled: boolean;
  createdAt: string;
  monthlyLimitUsd?: number | null;
  limitUsd: number | null;
  usage: { requests: number; costUsd: number };
}
export interface Invite {
  id: string;
  note: string;
  role: "admin" | "player";
  createdAt: string;
  expiresAt: string;
}

export const usd = (n: number) => `$${n.toFixed(2)}`;

export function UsageBar({ spent, limit }: { spent: number; limit: number | null }) {
  const pct = limit ? Math.min(100, (spent / limit) * 100) : 0;
  return (
    <div className="usage">
      <div className="usage-line">
        <b>{usd(spent)}</b>
        <span className="muted">{limit === null ? "no limit" : `of ${usd(limit)} this month`}</span>
      </div>
      {limit !== null && (
        <div className="usage-bar" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Thorgrim allowance used">
          <span className={pct >= 90 ? "high" : ""} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}
