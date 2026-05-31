import QRCode from "react-qr-code";
import { posCanonical } from "../../config/company";
import { buildAgentVerificationUrl } from "../../lib/referralAgents";

type Props = {
  referralCode: string;
  size?: number;
  className?: string;
  label?: string;
};

/** Scannable QR encoding https://pos.waka.ug/verify-agent/{code} */
export function AgentVerificationQr({ referralCode, size = 168, className = "", label }: Props) {
  const url = buildAgentVerificationUrl(referralCode);
  return (
    <figure className={`flex flex-col items-center gap-2 ${className}`}>
      <div className="rounded-2xl border-2 border-stone-200 bg-white p-3 shadow-sm">
        <QRCode
          value={url}
          size={size}
          level="M"
          bgColor="#ffffff"
          fgColor="#1c1917"
          title={label ?? `Verify Waka agent ${referralCode}`}
        />
      </div>
      <figcaption className="max-w-[14rem] break-all text-center text-[10px] font-medium text-stone-500">
        {posCanonical(`/verify-agent/${referralCode.trim().toUpperCase()}`)}
      </figcaption>
    </figure>
  );
}
