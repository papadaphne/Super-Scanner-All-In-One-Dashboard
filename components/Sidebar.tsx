
import React from 'react';
import { ViewType } from '../App';
import { DashboardIcon } from './icons/DashboardIcon';
import { CodeIcon } from './icons/CodeIcon';
import { AIIcon } from './icons/AIIcon';
import { IntegrationsIcon } from './icons/IntegrationsIcon';

interface SidebarProps {
  activeView: ViewType;
  setActiveView: (view: ViewType) => void;
}

const NavItem: React.FC<{
  icon: React.ReactNode;
  label: string;
  isActive: boolean;
  onClick: () => void;
}> = ({ icon, label, isActive, onClick }) => (
  <li>
    <button
      onClick={onClick}
      className={`flex items-center justify-center md:justify-start p-3 my-2 text-sm rounded-lg w-full transition-colors duration-200 ${
        isActive
          ? 'bg-primary text-white shadow-lg'
          : 'text-gray-400 hover:bg-gray-700 hover:text-white'
      }`}
    >
      {icon}
      <span className="hidden md:block ml-4">{label}</span>
    </button>
  </li>
);

const Sidebar: React.FC<SidebarProps> = ({ activeView, setActiveView }) => {
  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: <DashboardIcon /> },
    { id: 'python_bot', label: 'Python Bot', icon: <CodeIcon /> },
    { id: 'ai_prompt', label: 'Gemini AI Prompt', icon: <AIIcon /> },
    { id: 'integrations', label: 'Integrations', icon: <IntegrationsIcon /> },
  ];

  return (
    <aside className="fixed top-0 left-0 h-screen bg-gray-800 text-white w-16 md:w-64 z-10 transition-all duration-300 shadow-2xl">
      <div className="flex items-center justify-center h-20 border-b border-gray-700">
        <h1 className="text-xl font-bold text-white hidden md:block">
          Super<span className="text-primary">Scanner</span>
        </h1>
         <div className="md:hidden text-primary">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
        </div>
      </div>
      <nav className="p-2">
        <ul>
          {navItems.map((item) => (
            <NavItem
              key={item.id}
              icon={item.icon}
              label={item.label}
              isActive={activeView === item.id}
              onClick={() => setActiveView(item.id as ViewType)}
            />
          ))}
        </ul>
      </nav>
    </aside>
  );
};

export default Sidebar;
