export type Route =
  | { name: "discover" }
  | { name: "library" }
  | { name: "settings" }
  | { name: "read"; id: string };

export function parseHash(hash: string): Route | null {
  const path = hash.replace(/^#\/?/, "").split("?")[0];
  const [head, ...rest] = path.split("/");
  switch (head) {
    case "etal":
      return { name: "discover" };
    case "biblio":
      return { name: "library" };
    case "reglages":
      return { name: "settings" };
    case "lire": {
      const id = decodeURIComponent(rest.join("/"));
      return id ? { name: "read", id } : null;
    }
    default:
      return null;
  }
}

export function formatHash(route: Route): string {
  switch (route.name) {
    case "discover":
      return "#/etal";
    case "library":
      return "#/biblio";
    case "settings":
      return "#/reglages";
    case "read":
      return `#/lire/${encodeURIComponent(route.id)}`;
  }
}
