import type { Language } from "../../../types";
import { XFER_SECTION_LABEL } from "./transferTokens";

type Props = {
  title: string;
  lang?: Language;
};

export function TransferHeader({ title }: Props) {
  return <p className={XFER_SECTION_LABEL}>{title}</p>;
}
