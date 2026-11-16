import { Link } from "react-router-dom";

const cards = [
  {
    to: "/otc",
    icon: "⚖️",
    title: "OTC auction",
    body: "Sealed-bid batch auction. Commit hidden orders, reveal, and everyone clears at one uniform price. No front-running, no identity on-chain.",
  },
  {
    to: "/pool",
    icon: "🕶️",
    title: "Private pool",
    body: "Deposit a fixed amount and withdraw to any address with a zero-knowledge proof. Nothing links the two transactions.",
  },
  {
    to: "/htlc",
    icon: "🔗",
    title: "HTLC swap",
    body: "Hash-time-locked escrow for atomic swaps with another chain. Revealing the secret settles both legs; otherwise refund after expiry.",
  },
];

export default function Home() {
  return (
    <div className="bg-white text-gray-900 min-h-screen font-sans">
      <header className="text-center px-6 pt-20 pb-12 bg-gradient-to-r from-indigo-800 via-purple-700 to-blue-700 text-white">
        <h1 className="text-5xl font-bold mb-4">Umbra OTC</h1>
        <p className="text-xl max-w-2xl mx-auto">
          Private trading on Midnight: sealed-bid auctions, a shielded pool, and atomic swaps.
          Prove what is needed, reveal nothing more.
        </p>
      </header>

      <section className="py-16 px-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          {cards.map((c) => (
            <Link
              key={c.to}
              to={c.to}
              className="block border rounded-2xl p-6 hover:shadow-md transition text-center"
            >
              <div className="text-4xl mb-3">{c.icon}</div>
              <h3 className="text-xl font-semibold mb-2">{c.title}</h3>
              <p className="text-gray-600 text-sm">{c.body}</p>
            </Link>
          ))}
        </div>
      </section>

      <footer className="text-center py-8 border-t text-sm text-gray-500">
        © {new Date().getFullYear()} Umbra OTC · Built on Midnight
      </footer>
    </div>
  );
}
