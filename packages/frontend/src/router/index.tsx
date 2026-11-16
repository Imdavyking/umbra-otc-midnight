import { useRoutes } from "react-router-dom";
import Home from "../views/home/main";
import NotFound from "../views/not-found/main";
import HtlcPage from "../views/htlc/main";

function Router() {
  const routes = [
    { path: "/", element: <Home /> },
    { path: "/htlc", element: <HtlcPage /> },
    { path: "*", element: <NotFound /> },
  ];
  return useRoutes(routes);
}

export default Router;
