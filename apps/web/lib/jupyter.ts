export interface JupyterCell {
  cell_type: "code" | "markdown" | "raw";
  source: string | string[];
  metadata?: Record<string, unknown>;
}

export interface JupyterNotebook {
  cells: JupyterCell[];
  metadata?: {
    kernelspec?: {
      language?: string;
      display_name?: string;
    };
    language_info?: {
      name?: string;
    };
  };
  nbformat?: number;
  nbformat_minor?: number;
}

export interface ParsedCell {
  type: "code" | "markdown";
  content: string;
  language?: string;
}

export interface ParsedNotebook {
  title: string;
  cells: ParsedCell[];
  language: string;
}

function normalizeSource(source: string | string[]): string {
  if (Array.isArray(source)) {
    return source.join("");
  }
  return source;
}

function detectLanguage(notebook: JupyterNotebook): string {
  return (
    notebook.metadata?.kernelspec?.language ||
    notebook.metadata?.language_info?.name ||
    "python"
  );
}

export function parseJupyterNotebook(
  content: string,
  filename?: string,
): ParsedNotebook {
  const notebook: JupyterNotebook = JSON.parse(content);

  if (!notebook.cells || !Array.isArray(notebook.cells)) {
    throw new Error("Invalid Jupyter notebook: missing cells array");
  }

  const language = detectLanguage(notebook);
  const title = filename?.replace(/\.ipynb$/i, "") || "Imported Notebook";

  const cells: ParsedCell[] = notebook.cells
    .filter(
      (cell) => cell.cell_type !== "raw" || normalizeSource(cell.source).trim(),
    )
    .map((cell) => {
      const content = normalizeSource(cell.source);
      if (cell.cell_type === "code") {
        return { type: "code" as const, content, language };
      }
      return { type: "markdown" as const, content };
    });

  return { title, cells, language };
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsText(file);
  });
}
