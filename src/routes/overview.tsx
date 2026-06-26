import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/overview")({
  beforeLoad: () => {
    throw redirect({ to: "/" });
  },
});

import { redirect } from "@tanstack/react-router";
