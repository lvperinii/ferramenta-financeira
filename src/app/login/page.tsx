import { signIn } from "@/auth";
import styles from "../page.module.css";

export default function LoginPage() {
  async function entrarComGoogle() {
    "use server";
    await signIn("google", { redirectTo: "/" });
  }

  return (
    <main className={styles.main}>
      <h1>Controle Financeiro</h1>
      <p>Acesso restrito. Entre com sua conta Google autorizada.</p>
      <form action={entrarComGoogle}>
        <button type="submit" className={styles.button}>
          Entrar com Google
        </button>
      </form>
    </main>
  );
}
