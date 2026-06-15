import { createBrowserRouter, Navigate, RouterProvider, NavLink, Outlet } from 'react-router';
import { useState, useEffect } from 'react';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  useIsMobile,
} from '@databricks/appkit-ui/react';
import { Menu } from 'lucide-react';
import { AnalyticsPage } from './pages/analytics/AnalyticsPage';
import { ScenarioPage } from './pages/scenario/ScenarioPage';
import { LakebasePage } from './pages/lakebase/LakebasePage';
import { DataQualityPage } from './pages/data-quality/DataQualityPage';
import { GeniePage } from './pages/genie/GeniePage';
import { ServingPage } from './pages/serving/ServingPage';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
    isActive
      ? 'bg-primary text-primary-foreground'
      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
  }`;

const mobileNavLinkClass = ({ isActive }: { isActive: boolean }) =>
  `block px-3 py-2 rounded-md text-sm font-medium transition-colors ${
    isActive
      ? 'bg-primary text-primary-foreground'
      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
  }`;

type NavLinkClassFn = (props: { isActive: boolean }) => string;

function NavLinks({ className, linkClass, onClick }: { className?: string; linkClass: NavLinkClassFn; onClick?: () => void }) {
  return (
    <nav className={className}>
      <NavLink to="/" end className={linkClass} onClick={onClick}>
        Home
      </NavLink>
      <NavLink to="/analytics" className={linkClass} onClick={onClick}>
        Analytics
      </NavLink>
      <NavLink to="/scenario" className={linkClass} onClick={onClick}>
        Scenario
      </NavLink>
      <NavLink to="/data-quality" className={linkClass} onClick={onClick}>
        Data Quality
      </NavLink>
      <NavLink to="/lakebase" className={linkClass} onClick={onClick}>
        Lakebase
      </NavLink>
      <NavLink to="/genie" className={linkClass} onClick={onClick}>
        Genie
      </NavLink>
      <NavLink to="/serving" className={linkClass} onClick={onClick}>
        Serving
      </NavLink>
    </nav>
  );
}

function Layout() {
  const isMobile = useIsMobile();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Close mobile nav when viewport crosses to desktop
  useEffect(() => {
    if (!isMobile) setMobileNavOpen(false);
  }, [isMobile]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b px-4 md:px-6 py-3 flex items-center gap-4">
        <h1 className="text-lg font-semibold text-foreground">Virtue Foundation Explorer</h1>
        {/* Desktop nav — hidden below md breakpoint */}
        <NavLinks className="hidden md:flex gap-1" linkClass={navLinkClass} />
        {/* Mobile nav — visible below md breakpoint */}
        <div className="ml-auto md:hidden">
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <Button variant="ghost" size="icon" onClick={() => setMobileNavOpen(true)}>
              <Menu className="h-5 w-5" />
              <span className="sr-only">Open navigation</span>
            </Button>
            <SheetContent side="left">
              <SheetHeader>
                <SheetTitle>Navigation</SheetTitle>
              </SheetHeader>
              <NavLinks className="flex flex-col gap-1" linkClass={mobileNavLinkClass} onClick={() => setMobileNavOpen(false)} />
            </SheetContent>
          </Sheet>
        </div>
      </header>

      <main className="flex-1 p-4 md:p-6">
        <Outlet />
      </main>
    </div>
  );
}

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/analytics', element: <AnalyticsPage /> },
      { path: '/scenario', element: <ScenarioPage /> },
      { path: '/mappings', element: <Navigate to="/data-quality" replace /> },
      { path: '/data-quality', element: <DataQualityPage /> },
      { path: '/lakebase', element: <LakebasePage /> },
      { path: '/genie', element: <GeniePage /> },
      { path: '/serving', element: <ServingPage /> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}

function HomePage() {
  return (
    <div className="max-w-4xl mx-auto space-y-8 mt-4">
      <div className="rounded-2xl border bg-card p-8 md:p-10 shadow-sm">
        <p className="text-sm font-medium uppercase tracking-wide text-primary mb-3">
          DAIS 2026 Hackathon
        </p>
        <h2 className="text-3xl md:text-4xl font-bold mb-3 text-foreground">
          Virtue Foundation Healthcare Explorer
        </h2>
        <p className="text-lg text-muted-foreground max-w-2xl">
          Explore Indian healthcare facilities, ask natural-language questions with Genie,
          persist notes in Lakebase, and chat with Claude via Model Serving.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="shadow-sm border-border/60">
          <CardHeader>
            <CardTitle>Analytics</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Cleaned facility counts from <code className="text-xs">dais_2026.hackathon.facility</code>.
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-sm border-border/60">
          <CardHeader>
            <CardTitle>Scenario Analysis</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Model a new facility in a district and compare NFHS demand vs. supply metrics.
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-sm border-border/60">
          <CardHeader>
            <CardTitle>Genie</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Ask questions about facilities, health indicators, and pincode coverage in plain English.
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-sm border-border/60">
          <CardHeader>
            <CardTitle>Lakebase</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Persist scenario plans in managed Postgres — list, duplicate, and delete saved
              multi-facility scenarios.
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-sm border-border/60">
          <CardHeader>
            <CardTitle>AI Chat</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Stream responses from <code className="text-xs">databricks-claude-sonnet-4-6</code>.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
