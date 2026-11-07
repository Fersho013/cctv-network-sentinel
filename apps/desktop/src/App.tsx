import React, { useEffect } from 'react';
import DashboardGrid from './components/DashboardGrid';
import { runScanAndReport } from './heartbeat';

export default function App() {
  useEffect(() => {
    runScanAndReport('192.168.1.').catch(console.error);
    const id = setInterval(() => runScanAndReport('192.168.1.').catch(console.error), 30000);
    return () => clearInterval(id);
  }, []);

  return <DashboardGrid />;
}
