
import React, { useState } from 'react';
import Sidebar from './components/Sidebar';
import DashboardView from './components/DashboardView';
import PythonBotView from './components/PythonBotView';
import AIPromptView from './components/AIPromptView';
import IntegrationsView from './components/IntegrationsView';

export type ViewType = 'dashboard' | 'python_bot' | 'ai_prompt' | 'integrations';

const App: React.FC = () => {
  const [activeView, setActiveView] = useState<ViewType>('dashboard');

  const renderView = () => {
    switch (activeView) {
      case 'dashboard':
        return <DashboardView />;
      case 'python_bot':
        return <PythonBotView />;
      case 'ai_prompt':
        return <AIPromptView />;
      case 'integrations':
        return <IntegrationsView />;
      default:
        return <DashboardView />;
    }
  };

  return (
    <div className="flex min-h-screen bg-gray-900 font-sans">
      <Sidebar activeView={activeView} setActiveView={setActiveView} />
      <main className="flex-1 p-4 sm:p-6 lg:p-8 ml-16 md:ml-64 transition-all duration-300">
        {renderView()}
      </main>
    </div>
  );
};

export default App;
