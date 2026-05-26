import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { OwnDesignApp } from "@owndesign/renderer";
import "./main.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element not found.");
}

createRoot(root).render(
  <StrictMode>
    <OwnDesignApp apiBaseUrl="http://127.0.0.1:3711" />
  </StrictMode>,
);
