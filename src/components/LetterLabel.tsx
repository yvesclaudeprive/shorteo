/** Nom d'onglet avec la lettre du raccourci soulignée (Alt + lettre) : « Pipedrive » → P souligné. */
export function LetterLabel({ label, letter }: { label: string; letter: string }) {
  const i = label.toLowerCase().indexOf(letter.toLowerCase());
  if (!letter || i < 0) return <span className="letter-label">{label}</span>;
  return (
    <span className="letter-label">
      {label.slice(0, i)}
      <u className="acc-key">{label[i]}</u>
      {label.slice(i + 1)}
    </span>
  );
}
