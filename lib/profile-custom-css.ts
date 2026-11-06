/**
 * LOOP Pro profile CSS.
 *
 * This intentionally supports ordinary declarations only. Selectors are
 * always rooted under the profile wrapper; at-rules, remote resources and
 * layout/behaviour properties that could escape or break the page are denied.
 */
export const PROFILE_CUSTOM_CSS_MAX_LENGTH = 8_000;

const ALLOWED_PROPERTIES = new Set([
  "background",
  "background-color",
  "background-image",
  "border",
  "border-color",
  "border-radius",
  "border-style",
  "border-width",
  "box-shadow",
  "color",
  "column-gap",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "gap",
  "letter-spacing",
  "line-height",
  "margin",
  "max-height",
  "max-width",
  "min-height",
  "min-width",
  "outline",
  "outline-color",
  "outline-style",
  "outline-width",
  "opacity",
  "padding",
  "row-gap",
  "text-align",
  "text-decoration",
  "text-decoration-color",
  "text-decoration-style",
  "text-shadow",
  "text-transform",
  "word-spacing",
]);

export interface ProfileCustomCssValidation {
  valid: boolean;
  value: string;
  scopedCss: string;
  error?: string;
}

function invalid(error: string): ProfileCustomCssValidation {
  return { valid: false, value: "", scopedCss: "", error };
}

/** Split comma-separated selectors without splitting inside quotes or :is(). */
function splitSelectorList(value: string): string[] | null {
  const selectors: string[] = [];
  let current = "";
  let quote = "";
  let parentheses = 0;
  let brackets = 0;

  for (const character of value) {
    if (quote) {
      current += character;
      if (character === quote) quote = "";
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      current += character;
    } else if (character === "[") {
      brackets += 1;
      current += character;
    } else if (character === "]") {
      brackets -= 1;
      if (brackets < 0) return null;
      current += character;
    } else if (character === "(") {
      parentheses += 1;
      current += character;
    } else if (character === ")") {
      parentheses -= 1;
      if (parentheses < 0) return null;
      current += character;
    } else if (character === "," && parentheses === 0 && brackets === 0) {
      selectors.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }

  if (quote || parentheses !== 0 || brackets !== 0) return null;
  selectors.push(current.trim());
  return selectors;
}

/**
 * Validate CSS and return both its editable source and a profile-scoped
 * stylesheet. The same function is used by the API and the public renderer.
 */
export function validateProfileCustomCss(input: unknown): ProfileCustomCssValidation {
  if (typeof input !== "string") {
    return invalid("Custom CSS must be plain text.");
  }

  const source = input.trim();
  if (source.length > PROFILE_CUSTOM_CSS_MAX_LENGTH) {
    return invalid(`Custom CSS must be ${PROFILE_CUSTOM_CSS_MAX_LENGTH.toLocaleString()} characters or fewer.`);
  }

  if (!source) {
    return { valid: true, value: "", scopedCss: "" };
  }

  const css = source.replace(/\/\*[\s\S]*?\*\//g, "").trim();
  if (/\/\*|\*\//.test(css)) {
    return invalid("A CSS comment is not closed.");
  }

  if (
    /[@\\<>\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(css) ||
    /url\s*\(|image-set\s*\(|expression\s*\(|javascript\s*:|vbscript\s*:|data\s*:/i.test(css) ||
    /-moz-binding|behavior\s*:|<\/style|<!--/i.test(css)
  ) {
    return invalid("At-rules, scripts, external assets and CSS escape syntax are not supported.");
  }

  const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
  const rules = Array.from(css.matchAll(rulePattern));
  if (rules.length === 0 || css.replace(rulePattern, "").trim()) {
    return invalid("Use complete CSS rules with a selector and a declaration block.");
  }

  const scopedRules: string[] = [];
  for (const rule of rules) {
    const selectorText = rule[1].trim();
    const selectors = splitSelectorList(selectorText);
    if (
      !selectors ||
      selectors.length === 0 ||
      selectors.length > 12 ||
      selectors.some((selector) =>
        !selector ||
        selector.length > 180 ||
        !/^[A-Za-z0-9_.#:\[\]="'\s>+~()*-]+$/.test(selector) ||
        /:(?:root|host|global|deep|slotted|has)\b/i.test(selector)
      )
    ) {
      return invalid("One of the selectors is invalid or not allowed.");
    }

    const declarations: string[] = [];
    for (const declaration of rule[2].split(";")) {
      const trimmed = declaration.trim();
      if (!trimmed) continue;

      const separator = trimmed.indexOf(":");
      if (separator < 1) return invalid("Each declaration needs a property and value.");

      const property = trimmed.slice(0, separator).trim().toLowerCase();
      const value = trimmed.slice(separator + 1).trim();
      if (!ALLOWED_PROPERTIES.has(property)) {
        return invalid(`The "${property}" property is not supported in profile CSS.`);
      }
      if (
        !value ||
        value.length > 256 ||
        /[{};@\\<>\u0000-\u001F]/.test(value) ||
        /url\s*\(|image-set\s*\(|expression\s*\(|javascript\s*:|vbscript\s*:|data\s*:/i.test(value) ||
        !/^[A-Za-z0-9#.,%()'"\s:+*/_-]+$/.test(value)
      ) {
        return invalid(`The value for "${property}" is invalid or uses a blocked resource.`);
      }

      if (property === "background-image" && !/^none$/i.test(value) && !/gradient\(/i.test(value)) {
        return invalid("Background images are limited to CSS gradients; remote images are blocked.");
      }

      declarations.push(`${property}: ${value}`);
    }

    if (declarations.length === 0) {
      return invalid("Each CSS rule needs at least one supported declaration.");
    }

    const scopedSelectors = selectors
      .map((selector) => `[data-profile-custom-css] ${selector}`)
      .join(", ");
    scopedRules.push(`${scopedSelectors} { ${declarations.join("; ")}; }`);
  }

  return {
    valid: true,
    value: source,
    scopedCss: scopedRules.join("\n"),
  };
}
