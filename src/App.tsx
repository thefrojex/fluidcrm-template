import { Navigate, Route, Routes } from "react-router-dom";
import { AccountMenu, NoAccess, SignIn } from "./crm/Access.jsx";
import Board from "./crm/Board.jsx";
import TeamPage from "./crm/TeamPage.jsx";
import { setMe } from "./crm/lib/me.js";
import { useAuthUser, useMembership } from "./crm/session.js";

// FluidCRM: sign in (workspace login) → membership of the CRM (the workspace's, in core) decides
// access → the board shows their deals and their team's (all deals for its admin, sales managers
// and the workspace owner).

function Centered({ children }: { children: string }) {
  return (
    <main className="auth-page">
      <p className="auth-note">{children}</p>
    </main>
  );
}

function App() {
  const auth = useAuthUser();
  const membership = useMembership(auth.user?.id);

  if (auth.loading) return <Centered>Loading…</Centered>;
  if (!auth.user) return <SignIn />;
  if (membership.isLoading) return <Centered>Opening your board…</Centered>;
  if (membership.error) return <Centered>{`Couldn't open FluidCRM: ${membership.error.message}`}</Centered>;

  const member = membership.data;
  if (!member) return <NoAccess email={auth.user.email} />;

  setMe(member.name);
  const accountMenu = <AccountMenu member={member} />;
  return (
    <Routes>
      <Route path="/" element={<Board accountMenu={accountMenu} userId={member.user_id} />} />
      <Route path="/team" element={member.role === "admin" ? <TeamPage me={member} accountMenu={accountMenu} /> : <Navigate to="/" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
