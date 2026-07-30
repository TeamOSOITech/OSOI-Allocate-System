// Minimal classnames combiner — deliberately not `clsx`/`tailwind-merge` so
// this refactor adds zero new npm dependencies to the project.
export function cn(...classes: Array<string | false | null | undefined>) {
    return classes.filter(Boolean).join(" ");
}
