import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";

const queryClient = new QueryClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* basename matches whatever base this was actually served/built under (/preview/<token>/
          in the live dev-server preview, /p/<id>/ when published - see vite.config.ts) - without
          it, an absolute navigation like <Navigate to="/" /> (a normal 404-redirect-home pattern)
          would resolve to the real site root instead of staying inside this app's own mount path. */}
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
