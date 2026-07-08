type Props = {
  title: string;
  hint?: string;
};

export function WizardStepHeading({ title, hint }: Props) {
  return (
    <div className="space-y-2">
      <h2 className="text-[1.625rem] font-black leading-tight tracking-tight text-foreground">{title}</h2>
      {hint ? <p className="text-base leading-relaxed text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
