import type { ReactNode } from "react";
import { RECEIVE_SECTION_LABEL } from "./receiveTokens";

type Props = {
  title: string;
  action?: ReactNode;
};

export function ReceiveHeader({ title, action }: Props) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h3 className={RECEIVE_SECTION_LABEL}>{title}</h3>
      {action}
    </div>
  );
}
