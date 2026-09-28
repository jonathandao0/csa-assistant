import { Toaster } from './components/ui.jsx';
import EventPage from './pages/EventPage.jsx';
import Home from './pages/Home.jsx';
import Settings from './pages/Settings.jsx';
import TeamPage from './pages/TeamPage.jsx';
import TicketPage from './pages/TicketPage.jsx';
import { useRoute } from './lib/router.js';

// Routes:
//   #/                              events you're monitoring
//   #/settings
//   #/event/:key[/tab/:tab]         event tabs
//   #/event/:key/team/:number
//   #/event/:key/ticket/:id         (id "new" or "followup", optional /:team)
export default function App() {
  const [section, key, kind, a, b] = useRoute();
  let page = <Home />;
  if (section === 'settings') page = <Settings />;
  else if (section === 'event' && key) {
    if (kind === 'team') page = <TeamPage key={`${key}-${a}`} eventKey={key} number={Number(a)} />;
    else if (kind === 'ticket') page = <TicketPage key={`${a}-${b ?? ''}`} eventKey={key} id={a} presetTeam={b} />;
    else page = <EventPage eventKey={key} tab={kind === 'tab' ? a : undefined} />;
  }
  return (
    <div className="app">
      {page}
      <Toaster />
    </div>
  );
}
