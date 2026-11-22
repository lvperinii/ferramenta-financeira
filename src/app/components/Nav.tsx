import Link from "next/link";
import styles from "../finance.module.css";

const LINKS = [
  { href: "/", label: "Início" },
  { href: "/orcamento", label: "Painel" },
  { href: "/configuracoes", label: "Configurações" },
] as const;

export function Nav({ current }: { current: (typeof LINKS)[number]["href"] }) {
  return (
    <nav className={styles.nav} aria-label="Navegação principal">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} aria-current={l.href === current ? "page" : undefined}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
