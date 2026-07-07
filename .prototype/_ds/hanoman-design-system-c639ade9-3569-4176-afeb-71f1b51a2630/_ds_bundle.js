/* @ds-bundle: {"format":4,"namespace":"HanomanDesignSystem_c639ad","components":[{"name":"Icon","sourcePath":"components/core/Icon.jsx"},{"name":"Badge","sourcePath":"components/feedback/Badge.jsx"},{"name":"Callout","sourcePath":"components/feedback/Callout.jsx"},{"name":"ProgressBar","sourcePath":"components/feedback/ProgressBar.jsx"},{"name":"StatusPill","sourcePath":"components/feedback/StatusPill.jsx"},{"name":"Tooltip","sourcePath":"components/feedback/Tooltip.jsx"},{"name":"Button","sourcePath":"components/forms/Button.jsx"},{"name":"Checkbox","sourcePath":"components/forms/Checkbox.jsx"},{"name":"IconButton","sourcePath":"components/forms/IconButton.jsx"},{"name":"Input","sourcePath":"components/forms/Input.jsx"},{"name":"Select","sourcePath":"components/forms/Select.jsx"},{"name":"Switch","sourcePath":"components/forms/Switch.jsx"},{"name":"Tabs","sourcePath":"components/navigation/Tabs.jsx"},{"name":"Card","sourcePath":"components/surfaces/Card.jsx"}],"sourceHashes":{"components/core/Icon.jsx":"dbe58006aae5","components/feedback/Badge.jsx":"f95011938eb9","components/feedback/Callout.jsx":"e64c89b3d442","components/feedback/ProgressBar.jsx":"88b01ed6a4f4","components/feedback/StatusPill.jsx":"0395bd120a04","components/feedback/Tooltip.jsx":"a28aada018cc","components/forms/Button.jsx":"b44067eebabe","components/forms/Checkbox.jsx":"84b705748c6b","components/forms/IconButton.jsx":"73e29da3ce34","components/forms/Input.jsx":"d1edf0923ff5","components/forms/Select.jsx":"80a56fea453b","components/forms/Switch.jsx":"1ceb0854a262","components/navigation/Tabs.jsx":"e9a80664a99c","components/surfaces/Card.jsx":"448b5d80f49a","ui_kits/dashboard/BacklogScreen.jsx":"cd88e997b846","ui_kits/dashboard/DocsScreen.jsx":"96541c49f347","ui_kits/dashboard/ProjectsScreen.jsx":"7d9cc6195773","ui_kits/dashboard/RunsScreen.jsx":"a1b1f381c7a3","ui_kits/dashboard/Shell.jsx":"f5be0bd9f384","ui_kits/dashboard/TriggersScreen.jsx":"715bb104ffac","ui_kits/dashboard/data.js":"e710dd7ec048"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.HanomanDesignSystem_c639ad = window.HanomanDesignSystem_c639ad || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/core/Icon.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Icon — thin wrapper over Lucide (loaded via CDN as window.lucide).
 * Builds an inline <svg> per instance from the Lucide icon node, so
 * multiple sizes/weights on one page stay correct.
 */
function toPascal(name) {
  if (!name) return "";
  if (/^[A-Z]/.test(name) && !name.includes("-")) return name; // already Pascal
  return name.split(/[-_\s]+/).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join("");
}
function buildSvg(iconNode, {
  size,
  stroke
}) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  const base = {
    xmlns: NS,
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": stroke,
    "stroke-linecap": "round",
    "stroke-linejoin": "round"
  };
  Object.entries(base).forEach(([k, v]) => svg.setAttribute(k, v));
  // Lucide nodes come in two shapes:
  //   full node:  ["svg", attrs, [ [tag, attrs], ... ]]
  //   children:   [ [tag, attrs], ... ]
  const children = typeof iconNode[0] === "string" ? iconNode[2] || [] : iconNode || [];
  children.forEach(child => {
    if (!Array.isArray(child)) return;
    const [tag, attrs] = child;
    if (typeof tag !== "string") return;
    const el = document.createElementNS(NS, tag);
    Object.entries(attrs || {}).forEach(([k, v]) => el.setAttribute(k, v));
    svg.appendChild(el);
  });
  return svg;
}
function Icon({
  name,
  size = 18,
  stroke = 2,
  color = "currentColor",
  className = "",
  style = {},
  ...rest
}) {
  const ref = React.useRef(null);
  React.useLayoutEffect(() => {
    const host = ref.current;
    if (!host) return;
    const lucide = typeof window !== "undefined" ? window.lucide : null;
    const pascal = toPascal(name);
    const node = lucide && (lucide.icons && lucide.icons[pascal] || lucide[pascal]);
    if (node) {
      host.replaceChildren(buildSvg(node, {
        size,
        stroke
      }));
    } else {
      // graceful placeholder if lucide not loaded / unknown name
      host.replaceChildren();
    }
  }, [name, size, stroke]);
  return /*#__PURE__*/React.createElement("span", _extends({
    ref: ref,
    role: "img",
    "aria-label": name,
    className: className,
    style: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      color,
      width: size,
      height: size,
      flex: "0 0 auto",
      ...style
    }
  }, rest));
}
Object.assign(__ds_scope, { Icon });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Icon.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Badge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const TONES = {
  neutral: {
    bg: "var(--bone-200)",
    fg: "var(--ink-600)",
    bd: "var(--bone-400)"
  },
  brass: {
    bg: "var(--brass-100)",
    fg: "var(--brass-700)",
    bd: "var(--brass-300)"
  },
  info: {
    bg: "var(--wind-100)",
    fg: "var(--wind-700)",
    bd: "var(--wind-500)"
  },
  ok: {
    bg: "var(--status-ok-tint)",
    fg: "var(--leaf-600)",
    bd: "var(--leaf-500)"
  },
  warn: {
    bg: "var(--status-warn-tint)",
    fg: "var(--amber-600)",
    bd: "var(--amber-500)"
  },
  err: {
    bg: "var(--status-err-tint)",
    fg: "var(--clay-600)",
    bd: "var(--clay-500)"
  }
};
function Badge({
  children,
  tone = "neutral",
  icon,
  variant = "soft",
  size = "md",
  className = "",
  style = {},
  ...rest
}) {
  const t = TONES[tone] || TONES.neutral;
  const sm = size === "sm";
  const solid = variant === "solid";
  const outline = variant === "outline";
  return /*#__PURE__*/React.createElement("span", _extends({
    className: className,
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: sm ? 4 : 5,
      height: sm ? 18 : 22,
      padding: sm ? "0 7px" : "0 9px",
      borderRadius: "var(--radius-pill)",
      fontFamily: "var(--font-ui)",
      fontSize: sm ? "var(--text-2xs)" : "var(--text-xs)",
      fontWeight: "var(--weight-medium)",
      lineHeight: 1,
      letterSpacing: "0.01em",
      background: solid ? t.fg : outline ? "transparent" : t.bg,
      color: solid ? "var(--bone-000)" : t.fg,
      border: `1px solid ${outline ? t.bd : solid ? t.fg : "transparent"}`,
      whiteSpace: "nowrap",
      ...style
    }
  }, rest), icon && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: sm ? 11 : 13
  }), children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Badge.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Callout.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const TONES = {
  info: {
    fg: "var(--wind-700)",
    bg: "var(--wind-050)",
    bd: "var(--wind-500)",
    icon: "info"
  },
  ok: {
    fg: "var(--leaf-600)",
    bg: "var(--leaf-100)",
    bd: "var(--leaf-500)",
    icon: "check-circle-2"
  },
  warn: {
    fg: "var(--amber-600)",
    bg: "var(--status-warn-tint)",
    bd: "var(--amber-500)",
    icon: "alert-triangle"
  },
  err: {
    fg: "var(--clay-600)",
    bg: "var(--status-err-tint)",
    bd: "var(--clay-500)",
    icon: "octagon-alert"
  },
  brass: {
    fg: "var(--brass-700)",
    bg: "var(--brass-050)",
    bd: "var(--brass-400)",
    icon: "sparkles"
  }
};
function Callout({
  children,
  tone = "info",
  title,
  icon,
  action,
  className = "",
  style = {},
  ...rest
}) {
  const t = TONES[tone] || TONES.info;
  return /*#__PURE__*/React.createElement("div", _extends({
    className: className,
    role: "note",
    style: {
      display: "flex",
      gap: 12,
      padding: "14px 16px",
      background: t.bg,
      border: `1px solid ${t.bd}`,
      borderLeft: `3px solid ${t.fg}`,
      borderRadius: "var(--radius-md)",
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon || t.icon,
    size: 19,
    color: t.fg,
    style: {
      marginTop: 1
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, title && /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "var(--font-ui)",
      fontSize: "var(--text-md)",
      fontWeight: "var(--weight-semibold)",
      color: "var(--text-strong)",
      marginBottom: children ? 3 : 0
    }
  }, title), children && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "var(--text-sm)",
      lineHeight: "var(--leading-normal)",
      color: "var(--text-body)"
    }
  }, children), action && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 10
    }
  }, action)));
}
Object.assign(__ds_scope, { Callout });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Callout.jsx", error: String((e && e.message) || e) }); }

// components/feedback/ProgressBar.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const TONES = {
  brass: "var(--accent)",
  ok: "var(--leaf-600)",
  warn: "var(--amber-600)",
  err: "var(--clay-600)",
  info: "var(--wind-600)"
};
function ProgressBar({
  value = 0,
  max = 100,
  tone = "brass",
  size = "md",
  showLabel = false,
  label,
  className = "",
  style = {},
  ...rest
}) {
  const pct = Math.max(0, Math.min(100, value / max * 100));
  const h = size === "sm" ? 5 : size === "lg" ? 10 : 7;
  const color = TONES[tone] || TONES.brass;
  return /*#__PURE__*/React.createElement("div", _extends({
    className: className,
    style: {
      ...style
    }
  }, rest), (showLabel || label) && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "baseline",
      marginBottom: 6
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "var(--text-sm)",
      color: "var(--text-body)"
    }
  }, label), showLabel && /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: "var(--text-xs)",
      color: "var(--text-muted)"
    }
  }, Math.round(pct), "%")), /*#__PURE__*/React.createElement("div", {
    role: "progressbar",
    "aria-valuenow": value,
    "aria-valuemax": max,
    style: {
      height: h,
      background: "var(--bone-300)",
      borderRadius: "var(--radius-pill)",
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: pct + "%",
      height: "100%",
      background: color,
      borderRadius: "var(--radius-pill)",
      transition: "width var(--dur-slow) var(--ease-out)"
    }
  })));
}
Object.assign(__ds_scope, { ProgressBar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/ProgressBar.jsx", error: String((e && e.message) || e) }); }

// components/feedback/StatusPill.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * StatusPill — fixed vocabulary for repo & doc health across the
 * Hanoman dashboard. Consistent color + dot per status.
 */
const STATUS = {
  // Docs / convention health
  ok: {
    label: "On convention",
    color: "var(--leaf-600)",
    bg: "var(--status-ok-tint)",
    pulse: false
  },
  drift: {
    label: "Drifting",
    color: "var(--amber-600)",
    bg: "var(--status-warn-tint)",
    pulse: false
  },
  broken: {
    label: "Off convention",
    color: "var(--clay-600)",
    bg: "var(--status-err-tint)",
    pulse: false
  },
  // Claude Code run states
  running: {
    label: "Running",
    color: "var(--brass-600)",
    bg: "var(--brass-100)",
    pulse: true
  },
  queued: {
    label: "Queued",
    color: "var(--wind-600)",
    bg: "var(--wind-100)",
    pulse: false
  },
  done: {
    label: "Done",
    color: "var(--leaf-600)",
    bg: "var(--status-ok-tint)",
    pulse: false
  },
  failed: {
    label: "Failed",
    color: "var(--clay-600)",
    bg: "var(--status-err-tint)",
    pulse: false
  },
  // Generic
  scanning: {
    label: "Scanning",
    color: "var(--wind-600)",
    bg: "var(--wind-100)",
    pulse: true
  },
  idle: {
    label: "Idle",
    color: "var(--ink-500)",
    bg: "var(--bone-200)",
    pulse: false
  }
};
function StatusPill({
  status = "idle",
  children,
  size = "md",
  className = "",
  style = {},
  ...rest
}) {
  const s = STATUS[status] || STATUS.idle;
  const sm = size === "sm";
  const dot = sm ? 6 : 7;
  return /*#__PURE__*/React.createElement("span", _extends({
    className: className,
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: sm ? 5 : 6,
      height: sm ? 20 : 24,
      padding: sm ? "0 8px 0 7px" : "0 10px 0 8px",
      borderRadius: "var(--radius-pill)",
      background: s.bg,
      color: s.color,
      fontFamily: "var(--font-ui)",
      fontSize: sm ? "var(--text-2xs)" : "var(--text-xs)",
      fontWeight: "var(--weight-medium)",
      lineHeight: 1,
      whiteSpace: "nowrap",
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    style: {
      width: dot,
      height: dot,
      borderRadius: "50%",
      background: s.color,
      flex: "0 0 auto",
      animation: s.pulse ? "hn-pulse 1.4s ease-in-out infinite" : "none"
    }
  }), children || s.label, /*#__PURE__*/React.createElement("style", null, `@keyframes hn-pulse{0%,100%{opacity:1}50%{opacity:.35}}`));
}
Object.assign(__ds_scope, { StatusPill });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/StatusPill.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Tooltip.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Tooltip({
  content,
  children,
  placement = "top",
  className = "",
  style = {},
  ...rest
}) {
  const [show, setShow] = React.useState(false);
  const pos = {
    top: {
      bottom: "calc(100% + 8px)",
      left: "50%",
      transform: "translateX(-50%)"
    },
    bottom: {
      top: "calc(100% + 8px)",
      left: "50%",
      transform: "translateX(-50%)"
    },
    left: {
      right: "calc(100% + 8px)",
      top: "50%",
      transform: "translateY(-50%)"
    },
    right: {
      left: "calc(100% + 8px)",
      top: "50%",
      transform: "translateY(-50%)"
    }
  }[placement];
  return /*#__PURE__*/React.createElement("span", _extends({
    className: className,
    onMouseEnter: () => setShow(true),
    onMouseLeave: () => setShow(false),
    onFocus: () => setShow(true),
    onBlur: () => setShow(false),
    style: {
      position: "relative",
      display: "inline-flex",
      ...style
    }
  }, rest), children, /*#__PURE__*/React.createElement("span", {
    role: "tooltip",
    style: {
      position: "absolute",
      zIndex: 40,
      ...pos,
      padding: "5px 9px",
      background: "var(--ink-900)",
      color: "var(--bone-100)",
      fontFamily: "var(--font-ui)",
      fontSize: "var(--text-xs)",
      lineHeight: 1.3,
      fontWeight: "var(--weight-medium)",
      borderRadius: "var(--radius-sm)",
      boxShadow: "var(--shadow-lg)",
      whiteSpace: "nowrap",
      pointerEvents: "none",
      opacity: show ? 1 : 0,
      transform: `${pos.transform} translateY(${show ? "0" : placement === "top" ? "2px" : "-2px"})`,
      transition: "opacity var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out)"
    }
  }, content));
}
Object.assign(__ds_scope, { Tooltip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Tooltip.jsx", error: String((e && e.message) || e) }); }

// components/forms/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const SIZES = {
  sm: {
    h: 30,
    px: 12,
    fs: "var(--text-sm)",
    gap: 6,
    icon: 15
  },
  md: {
    h: 38,
    px: 16,
    fs: "var(--text-md)",
    gap: 8,
    icon: 17
  },
  lg: {
    h: 46,
    px: 22,
    fs: "var(--text-base)",
    gap: 9,
    icon: 19
  }
};
function variantStyle(variant) {
  switch (variant) {
    case "secondary":
      return {
        background: "var(--surface-card)",
        color: "var(--text-strong)",
        border: "1px solid var(--border-strong)",
        boxShadow: "var(--shadow-xs)"
      };
    case "ghost":
      return {
        background: "transparent",
        color: "var(--text-body)",
        border: "1px solid transparent"
      };
    case "danger":
      return {
        background: "var(--clay-600)",
        color: "#fff",
        border: "1px solid var(--clay-600)"
      };
    case "primary":
    default:
      return {
        background: "var(--accent)",
        color: "var(--accent-on)",
        border: "1px solid var(--accent)",
        boxShadow: "var(--shadow-xs)"
      };
  }
}
function Button({
  children,
  variant = "primary",
  size = "md",
  leftIcon,
  rightIcon,
  loading = false,
  disabled = false,
  fullWidth = false,
  type = "button",
  className = "",
  style = {},
  ...rest
}) {
  const s = SIZES[size] || SIZES.md;
  const [hover, setHover] = React.useState(false);
  const [active, setActive] = React.useState(false);
  const isDisabled = disabled || loading;
  const base = variantStyle(variant);
  const hoverOverlay = variant === "ghost" ? {
    background: "var(--bone-200)"
  } : variant === "secondary" ? {
    background: "var(--bone-100)",
    borderColor: "var(--ink-300)"
  } : {
    filter: "brightness(0.95)"
  };
  return /*#__PURE__*/React.createElement("button", _extends({
    type: type,
    disabled: isDisabled,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => {
      setHover(false);
      setActive(false);
    },
    onMouseDown: () => setActive(true),
    onMouseUp: () => setActive(false),
    className: className,
    style: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: s.gap,
      height: s.h,
      padding: `0 ${s.px}px`,
      width: fullWidth ? "100%" : "auto",
      font: `var(--weight-medium) ${s.fs}/1 var(--font-ui)`,
      letterSpacing: "0.005em",
      borderRadius: "var(--radius-sm)",
      cursor: isDisabled ? "not-allowed" : "pointer",
      opacity: isDisabled ? 0.5 : 1,
      transition: "var(--transition-fast)",
      transform: active && !isDisabled ? "translateY(0.5px)" : "none",
      outline: "none",
      whiteSpace: "nowrap",
      ...base,
      ...(hover && !isDisabled ? hoverOverlay : null),
      ...style
    }
  }, rest), loading && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "loader-2",
    size: s.icon,
    style: {
      animation: "hn-spin 0.7s linear infinite"
    }
  }), !loading && leftIcon && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: leftIcon,
    size: s.icon
  }), children != null && /*#__PURE__*/React.createElement("span", null, children), !loading && rightIcon && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: rightIcon,
    size: s.icon
  }), /*#__PURE__*/React.createElement("style", null, `@keyframes hn-spin{to{transform:rotate(360deg)}}`));
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Button.jsx", error: String((e && e.message) || e) }); }

// components/forms/Checkbox.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Checkbox({
  checked,
  defaultChecked,
  onChange,
  label,
  description,
  disabled = false,
  className = "",
  style = {},
  ...rest
}) {
  const isControlled = checked !== undefined;
  const [inner, setInner] = React.useState(!!defaultChecked);
  const on = isControlled ? checked : inner;
  const toggle = e => {
    if (disabled) return;
    if (!isControlled) setInner(v => !v);
    onChange && onChange(!on, e);
  };
  return /*#__PURE__*/React.createElement("label", _extends({
    className: className,
    style: {
      display: "inline-flex",
      alignItems: description ? "flex-start" : "center",
      gap: 10,
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.55 : 1,
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    onClick: toggle,
    style: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: 18,
      height: 18,
      marginTop: description ? 2 : 0,
      borderRadius: "var(--radius-xs)",
      background: on ? "var(--accent)" : "var(--surface-card)",
      border: `1.5px solid ${on ? "var(--accent)" : "var(--border-strong)"}`,
      boxShadow: on ? "none" : "var(--shadow-inset)",
      transition: "var(--transition-fast)",
      flex: "0 0 auto"
    }
  }, on && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "check",
    size: 13,
    stroke: 3,
    color: "var(--accent-on)"
  })), (label || description) && /*#__PURE__*/React.createElement("span", {
    onClick: toggle,
    style: {
      userSelect: "none"
    }
  }, label && /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block",
      fontSize: "var(--text-md)",
      color: "var(--text-strong)",
      lineHeight: 1.4
    }
  }, label), description && /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block",
      fontSize: "var(--text-sm)",
      color: "var(--text-muted)",
      lineHeight: 1.45
    }
  }, description)));
}
Object.assign(__ds_scope, { Checkbox });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Checkbox.jsx", error: String((e && e.message) || e) }); }

// components/forms/IconButton.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const SIZES = {
  sm: {
    box: 30,
    icon: 16
  },
  md: {
    box: 38,
    icon: 18
  },
  lg: {
    box: 46,
    icon: 20
  }
};
function IconButton({
  icon,
  label,
  variant = "ghost",
  size = "md",
  disabled = false,
  className = "",
  style = {},
  ...rest
}) {
  const s = SIZES[size] || SIZES.md;
  const [hover, setHover] = React.useState(false);
  const base = variant === "solid" ? {
    background: "var(--accent)",
    color: "var(--accent-on)",
    border: "1px solid var(--accent)"
  } : variant === "outline" ? {
    background: "var(--surface-card)",
    color: "var(--text-body)",
    border: "1px solid var(--border-strong)"
  } : {
    background: "transparent",
    color: "var(--text-muted)",
    border: "1px solid transparent"
  };
  const hoverOverlay = variant === "solid" ? {
    filter: "brightness(0.95)"
  } : variant === "outline" ? {
    background: "var(--bone-100)",
    borderColor: "var(--ink-300)",
    color: "var(--text-strong)"
  } : {
    background: "var(--bone-200)",
    color: "var(--text-strong)"
  };
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    "aria-label": label,
    title: label,
    disabled: disabled,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    className: className,
    style: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: s.box,
      height: s.box,
      borderRadius: "var(--radius-sm)",
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.5 : 1,
      transition: "var(--transition-fast)",
      outline: "none",
      ...base,
      ...(hover && !disabled ? hoverOverlay : null),
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: s.icon
  }));
}
Object.assign(__ds_scope, { IconButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/IconButton.jsx", error: String((e && e.message) || e) }); }

// components/forms/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const SIZES = {
  sm: {
    h: 30,
    px: 10,
    fs: "var(--text-sm)",
    icon: 15
  },
  md: {
    h: 38,
    px: 12,
    fs: "var(--text-md)",
    icon: 17
  },
  lg: {
    h: 46,
    px: 14,
    fs: "var(--text-base)",
    icon: 19
  }
};
function Input({
  size = "md",
  leftIcon,
  rightIcon,
  invalid = false,
  disabled = false,
  mono = false,
  className = "",
  style = {},
  ...rest
}) {
  const s = SIZES[size] || SIZES.md;
  const [focus, setFocus] = React.useState(false);
  const borderColor = invalid ? "var(--status-err)" : focus ? "var(--border-focus)" : "var(--border-strong)";
  return /*#__PURE__*/React.createElement("div", {
    className: className,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      height: s.h,
      padding: `0 ${s.px}px`,
      background: disabled ? "var(--bone-200)" : "var(--surface-card)",
      border: `1px solid ${borderColor}`,
      borderRadius: "var(--radius-sm)",
      boxShadow: focus ? "var(--ring)" : invalid ? "none" : "var(--shadow-inset)",
      transition: "var(--transition-fast)",
      opacity: disabled ? 0.6 : 1,
      ...style
    }
  }, leftIcon && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: leftIcon,
    size: s.icon,
    color: "var(--text-subtle)"
  }), /*#__PURE__*/React.createElement("input", _extends({
    disabled: disabled,
    onFocus: e => {
      setFocus(true);
      rest.onFocus && rest.onFocus(e);
    },
    onBlur: e => {
      setFocus(false);
      rest.onBlur && rest.onBlur(e);
    }
  }, rest, {
    style: {
      flex: 1,
      minWidth: 0,
      border: "none",
      outline: "none",
      background: "transparent",
      color: "var(--text-strong)",
      fontFamily: mono ? "var(--font-mono)" : "var(--font-ui)",
      fontSize: s.fs,
      lineHeight: 1.2
    }
  })), rightIcon && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: rightIcon,
    size: s.icon,
    color: "var(--text-subtle)"
  }));
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Input.jsx", error: String((e && e.message) || e) }); }

// components/forms/Select.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const SIZES = {
  sm: {
    h: 30,
    px: 10,
    fs: "var(--text-sm)"
  },
  md: {
    h: 38,
    px: 12,
    fs: "var(--text-md)"
  },
  lg: {
    h: 46,
    px: 14,
    fs: "var(--text-base)"
  }
};
function Select({
  options = [],
  value,
  defaultValue,
  onChange,
  size = "md",
  disabled = false,
  invalid = false,
  placeholder,
  className = "",
  style = {},
  ...rest
}) {
  const s = SIZES[size] || SIZES.md;
  const [focus, setFocus] = React.useState(false);
  const borderColor = invalid ? "var(--status-err)" : focus ? "var(--border-focus)" : "var(--border-strong)";
  const norm = options.map(o => typeof o === "string" ? {
    value: o,
    label: o
  } : o);
  return /*#__PURE__*/React.createElement("div", {
    className: className,
    style: {
      position: "relative",
      display: "inline-flex",
      alignItems: "center",
      height: s.h,
      background: disabled ? "var(--bone-200)" : "var(--surface-card)",
      border: `1px solid ${borderColor}`,
      borderRadius: "var(--radius-sm)",
      boxShadow: focus ? "var(--ring)" : "var(--shadow-inset)",
      transition: "var(--transition-fast)",
      opacity: disabled ? 0.6 : 1,
      ...style
    }
  }, /*#__PURE__*/React.createElement("select", _extends({
    value: value,
    defaultValue: defaultValue,
    onChange: onChange,
    disabled: disabled,
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false)
  }, rest, {
    style: {
      appearance: "none",
      WebkitAppearance: "none",
      border: "none",
      outline: "none",
      background: "transparent",
      color: "var(--text-strong)",
      fontFamily: "var(--font-ui)",
      fontSize: s.fs,
      height: "100%",
      padding: `0 ${s.px + 22}px 0 ${s.px}px`,
      cursor: disabled ? "not-allowed" : "pointer"
    }
  }), placeholder && /*#__PURE__*/React.createElement("option", {
    value: "",
    disabled: true
  }, placeholder), norm.map(o => /*#__PURE__*/React.createElement("option", {
    key: o.value,
    value: o.value
  }, o.label))), /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "chevron-down",
    size: 16,
    color: "var(--text-subtle)",
    style: {
      position: "absolute",
      right: s.px,
      pointerEvents: "none"
    }
  }));
}
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Select.jsx", error: String((e && e.message) || e) }); }

// components/forms/Switch.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const SIZES = {
  sm: {
    w: 32,
    h: 18,
    knob: 14
  },
  md: {
    w: 40,
    h: 22,
    knob: 18
  }
};
function Switch({
  checked,
  defaultChecked,
  onChange,
  size = "md",
  disabled = false,
  label,
  className = "",
  style = {},
  ...rest
}) {
  const s = SIZES[size] || SIZES.md;
  const isControlled = checked !== undefined;
  const [inner, setInner] = React.useState(!!defaultChecked);
  const on = isControlled ? checked : inner;
  const toggle = e => {
    if (disabled) return;
    if (!isControlled) setInner(v => !v);
    onChange && onChange(!on, e);
  };
  const track = /*#__PURE__*/React.createElement("span", {
    role: "switch",
    "aria-checked": on,
    onClick: toggle,
    style: {
      position: "relative",
      display: "inline-block",
      width: s.w,
      height: s.h,
      borderRadius: "var(--radius-pill)",
      background: on ? "var(--accent)" : "var(--ink-300)",
      border: "1px solid " + (on ? "var(--accent-hover)" : "var(--ink-300)"),
      transition: "var(--transition-fast)",
      cursor: disabled ? "not-allowed" : "pointer",
      flex: "0 0 auto"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      top: "50%",
      left: on ? s.w - s.knob - 3 : 2,
      transform: "translateY(-50%)",
      width: s.knob,
      height: s.knob,
      borderRadius: "50%",
      background: "var(--bone-000)",
      boxShadow: "var(--shadow-sm)",
      transition: "var(--transition-fast)"
    }
  }));
  if (!label) {
    return /*#__PURE__*/React.createElement("span", _extends({
      className: className,
      style: {
        opacity: disabled ? 0.55 : 1,
        ...style
      }
    }, rest), track);
  }
  return /*#__PURE__*/React.createElement("label", _extends({
    className: className,
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 10,
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.55 : 1,
      ...style
    }
  }, rest), track, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "var(--text-md)",
      color: "var(--text-strong)",
      userSelect: "none"
    }
  }, label));
}
Object.assign(__ds_scope, { Switch });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Switch.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Tabs.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Tabs({
  tabs = [],
  value,
  defaultValue,
  onChange,
  variant = "underline",
  className = "",
  style = {},
  ...rest
}) {
  const norm = tabs.map(t => typeof t === "string" ? {
    value: t,
    label: t
  } : t);
  const isControlled = value !== undefined;
  const [inner, setInner] = React.useState(defaultValue ?? (norm[0] && norm[0].value));
  const active = isControlled ? value : inner;
  const select = v => {
    if (!isControlled) setInner(v);
    onChange && onChange(v);
  };
  const pill = variant === "pill";
  return /*#__PURE__*/React.createElement("div", _extends({
    className: className,
    role: "tablist",
    style: {
      display: "inline-flex",
      gap: pill ? 4 : 0,
      padding: pill ? 4 : 0,
      background: pill ? "var(--bone-200)" : "transparent",
      borderRadius: pill ? "var(--radius-md)" : 0,
      borderBottom: pill ? "none" : "1px solid var(--border-hair)",
      ...style
    }
  }, rest), norm.map(t => {
    const on = t.value === active;
    return /*#__PURE__*/React.createElement("button", {
      key: t.value,
      role: "tab",
      "aria-selected": on,
      onClick: () => select(t.value),
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: pill ? "6px 12px" : "9px 14px",
        marginBottom: pill ? 0 : -1,
        border: "none",
        background: pill && on ? "var(--surface-card)" : "transparent",
        boxShadow: pill && on ? "var(--shadow-xs)" : "none",
        borderRadius: pill ? "var(--radius-sm)" : 0,
        borderBottom: pill ? "none" : `2px solid ${on ? "var(--accent)" : "transparent"}`,
        color: on ? "var(--text-strong)" : "var(--text-muted)",
        fontFamily: "var(--font-ui)",
        fontSize: "var(--text-md)",
        fontWeight: on ? "var(--weight-semibold)" : "var(--weight-medium)",
        cursor: "pointer",
        transition: "var(--transition-fast)",
        whiteSpace: "nowrap"
      }
    }, t.icon && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
      name: t.icon,
      size: 15
    }), t.label, t.count != null && /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: "var(--font-mono)",
        fontSize: "var(--text-2xs)",
        color: on ? "var(--accent-hover)" : "var(--text-subtle)",
        background: on ? "var(--brass-100)" : "var(--bone-300)",
        borderRadius: "var(--radius-pill)",
        padding: "1px 6px"
      }
    }, t.count));
  }));
}
Object.assign(__ds_scope, { Tabs });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Tabs.jsx", error: String((e && e.message) || e) }); }

// components/surfaces/Card.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Card({
  children,
  title,
  eyebrow,
  actions,
  footer,
  elevation = "raised",
  interactive = false,
  padding = 20,
  className = "",
  style = {},
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  const shadow = {
    flat: "none",
    raised: "var(--shadow-sm)",
    float: "var(--shadow-md)"
  }[elevation] || "var(--shadow-sm)";
  const hasHeader = title || eyebrow || actions;
  return /*#__PURE__*/React.createElement("div", _extends({
    className: className,
    onMouseEnter: () => interactive && setHover(true),
    onMouseLeave: () => interactive && setHover(false),
    style: {
      background: "var(--surface-card)",
      border: "1px solid var(--border-hair)",
      borderRadius: "var(--radius-lg)",
      boxShadow: interactive && hover ? "var(--shadow-md)" : shadow,
      transform: interactive && hover ? "translateY(-1px)" : "none",
      transition: "var(--transition-base)",
      cursor: interactive ? "pointer" : "default",
      overflow: "hidden",
      ...style
    }
  }, rest), hasHeader && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: 12,
      padding: `${padding}px ${padding}px ${title && children ? 0 : padding}px`
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, eyebrow && /*#__PURE__*/React.createElement("div", {
    className: "hn-eyebrow",
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: "var(--text-2xs)",
      fontWeight: "var(--weight-medium)",
      letterSpacing: "var(--tracking-caps)",
      textTransform: "uppercase",
      color: "var(--text-muted)",
      marginBottom: 5
    }
  }, eyebrow), title && /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "var(--font-display)",
      fontSize: "var(--text-xl)",
      fontWeight: "var(--weight-semibold)",
      letterSpacing: "var(--tracking-tight)",
      color: "var(--text-strong)",
      lineHeight: 1.2
    }
  }, title)), actions && /*#__PURE__*/React.createElement("div", {
    style: {
      flex: "0 0 auto"
    }
  }, actions)), children && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: hasHeader ? `12px ${padding}px ${padding}px` : padding
    }
  }, children), footer && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: `12px ${padding}px`,
      borderTop: "1px solid var(--border-hair)",
      background: "var(--bone-100)"
    }
  }, footer));
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/surfaces/Card.jsx", error: String((e && e.message) || e) }); }

// ui_kits/dashboard/BacklogScreen.jsx
try { (() => {
const {
  Card,
  Badge,
  Icon,
  Tabs,
  Button
} = window.HanomanDesignSystem_c639ad;
const STAGES = [{
  key: "brainstorming",
  label: "Brainstorm"
}, {
  key: "objective",
  label: "Objective"
}, {
  key: "spec-ready",
  label: "Spec"
}, {
  key: "planned",
  label: "Plan"
}, {
  key: "executing",
  label: "Execute"
}, {
  key: "done",
  label: "Done"
}];
const stageIndex = k => STAGES.findIndex(s => s.key === k);
function StageBar({
  stage
}) {
  const idx = stageIndex(stage);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 4
    }
  }, STAGES.map((s, i) => {
    const done = i < idx || stage === "done";
    const active = i === idx && stage !== "done";
    return /*#__PURE__*/React.createElement("div", {
      key: s.key,
      style: {
        display: "flex",
        alignItems: "center",
        gap: 4
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: active ? "3px 9px" : 0,
        borderRadius: "var(--radius-pill)",
        background: active ? "var(--brass-100)" : "transparent"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: done ? "var(--leaf-500)" : active ? "var(--brass-500)" : "var(--bone-400)"
      }
    }), active && /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        fontWeight: 500,
        color: "var(--brass-700)"
      }
    }, s.label)), i < STAGES.length - 1 && /*#__PURE__*/React.createElement("span", {
      style: {
        width: 12,
        height: 1.5,
        background: i < idx || stage === "done" ? "var(--leaf-500)" : "var(--bone-300)"
      }
    }));
  }));
}
function SpecCard({
  spec
}) {
  const qa = spec.source === "qa";
  return /*#__PURE__*/React.createElement(Card, {
    padding: 16
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 12,
      color: "var(--text-subtle)"
    }
  }, spec.id), /*#__PURE__*/React.createElement(Badge, {
    tone: qa ? "err" : "brass",
    size: "sm",
    icon: qa ? "bug" : "lightbulb"
  }, qa ? "QA finding" : "feature brief"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 11,
      color: "var(--text-muted)"
    }
  }, "\xB7 ", spec.project)), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "var(--font-sans)",
      fontSize: 15,
      fontWeight: 600,
      color: "var(--text-strong)",
      marginTop: 8
    }
  }, spec.title), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: "var(--text-muted)",
      marginTop: 4,
      lineHeight: 1.45
    }
  }, spec.objective))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: 14,
      paddingTop: 12,
      borderTop: "1px solid var(--border-hair)"
    }
  }, /*#__PURE__*/React.createElement(StageBar, {
    stage: spec.stage
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 11,
      color: "var(--text-subtle)"
    }
  }, spec.author)));
}
function BacklogScreen({
  backlog
}) {
  const [filter, setFilter] = React.useState("all");
  const items = filter === "all" ? backlog : backlog.filter(s => s.source === filter);
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 18
    }
  }, /*#__PURE__*/React.createElement(Tabs, {
    variant: "pill",
    value: filter,
    onChange: setFilter,
    tabs: [{
      value: "all",
      label: "All specs"
    }, {
      value: "brief",
      label: "From briefs"
    }, {
      value: "qa",
      label: "From QA"
    }]
  }), /*#__PURE__*/React.createElement("span", {
    className: "hn-eyebrow"
  }, items.length, " specs \xB7 brainstorm \u2192 execute")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 12
    }
  }, items.map(s => /*#__PURE__*/React.createElement(SpecCard, {
    key: s.id,
    spec: s
  }))));
}
Object.assign(window, {
  BacklogScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/dashboard/BacklogScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/dashboard/DocsScreen.jsx
try { (() => {
const {
  Card,
  StatusPill,
  Badge,
  Button,
  ProgressBar,
  Icon,
  Callout
} = window.HanomanDesignSystem_c639ad;
function CatRow({
  node
}) {
  const [open, setOpen] = React.useState(!node.linked);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      borderBottom: "1px solid var(--border-hair)"
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setOpen(o => !o),
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      width: "100%",
      padding: "10px 4px",
      border: "none",
      background: "transparent",
      cursor: "pointer",
      textAlign: "left"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: open ? "chevron-down" : "chevron-right",
    size: 15,
    color: "var(--text-subtle)"
  }), /*#__PURE__*/React.createElement(Icon, {
    name: "folder",
    size: 16,
    color: node.linked ? "var(--brass-500)" : "var(--clay-500)"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 13,
      color: "var(--text-strong)",
      fontWeight: 500
    }
  }, node.cat, "/"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 11,
      color: "var(--text-subtle)"
    }
  }, node.files.length), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }), node.linked ? /*#__PURE__*/React.createElement(Badge, {
    tone: "ok",
    size: "sm",
    icon: "link"
  }, "indexed") : /*#__PURE__*/React.createElement(Badge, {
    tone: "err",
    size: "sm",
    icon: "unlink"
  }, "unlinked")), open && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "0 4px 10px 40px",
      display: "flex",
      flexDirection: "column",
      gap: 4
    }
  }, node.files.map(f => /*#__PURE__*/React.createElement("div", {
    key: f,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "file-text",
    size: 13,
    color: "var(--text-subtle)"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 12,
      color: node.linked ? "var(--text-body)" : "var(--text-muted)"
    }
  }, f)))));
}
function DocsScreen({
  project,
  docTree
}) {
  const linked = docTree.filter(d => d.linked).length;
  const covTone = project.docStatus === "broken" ? "err" : project.docStatus === "drift" ? "warn" : "ok";
  const unlinked = docTree.filter(d => !d.linked);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1.4fr 1fr",
      gap: 20,
      alignItems: "start"
    }
  }, /*#__PURE__*/React.createElement(Card, {
    eyebrow: "internal/docs/README.md",
    title: "Source of Truth",
    actions: /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: "ghost",
      leftIcon: "refresh-cw"
    }, "Re-scan")
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 6,
      fontSize: 13,
      color: "var(--text-muted)"
    }
  }, "Docs drive the build. Every doc under ", /*#__PURE__*/React.createElement("code", null, "internal/docs/**"), " must be linked from this index before plans can execute."), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 8
    }
  }, docTree.map(n => /*#__PURE__*/React.createElement(CatRow, {
    key: n.cat,
    node: n
  })))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(Card, {
    padding: 18
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "hn-eyebrow"
  }, "SoT coverage \xB7 ", project.name), /*#__PURE__*/React.createElement(StatusPill, {
    status: project.docStatus,
    size: "sm"
  })), /*#__PURE__*/React.createElement(ProgressBar, {
    value: project.coverage,
    showLabel: true,
    label: "Doc categories indexed",
    tone: covTone
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 12,
      fontFamily: "var(--font-mono)",
      fontSize: 12,
      color: "var(--text-muted)"
    }
  }, linked, "/", docTree.length, " categories linked")), unlinked.length > 0 ? /*#__PURE__*/React.createElement(Callout, {
    tone: "warn",
    title: `${unlinked.length} categories not indexed`,
    action: /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      leftIcon: "wand-sparkles"
    }, "Generate & link")
  }, unlinked.map(u => u.cat).join(", "), " aren't linked from the index. hanoman can draft them from the codebase and wire them in.") : /*#__PURE__*/React.createElement(Callout, {
    tone: "ok",
    title: "Source of Truth complete"
  })));
}
Object.assign(window, {
  DocsScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/dashboard/DocsScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/dashboard/ProjectsScreen.jsx
try { (() => {
const {
  Card,
  StatusPill,
  Badge,
  ProgressBar,
  Icon
} = window.HanomanDesignSystem_c639ad;
function StatStrip({
  projects,
  runs
}) {
  const activeRuns = runs.filter(r => r.status === "running").length;
  const backlog = projects.reduce((n, p) => n + p.backlog, 0);
  const onConv = projects.filter(p => p.docStatus === "ok").length;
  const attention = projects.filter(p => p.run.status === "failed" || p.docStatus === "broken").length;
  const stats = [{
    label: "Active runs",
    value: activeRuns,
    dot: "var(--brass-500)"
  }, {
    label: "In backlog",
    value: backlog,
    dot: "var(--wind-600)"
  }, {
    label: "On convention",
    value: onConv + "/" + projects.length,
    dot: "var(--leaf-600)"
  }, {
    label: "Need attention",
    value: attention,
    dot: "var(--clay-600)"
  }];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(4, 1fr)",
      gap: 1,
      background: "var(--border-hair)",
      border: "1px solid var(--border-hair)",
      borderRadius: "var(--radius-lg)",
      overflow: "hidden",
      marginBottom: 22
    }
  }, stats.map(s => /*#__PURE__*/React.createElement("div", {
    key: s.label,
    style: {
      background: "var(--surface-card)",
      padding: "16px 18px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 7
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 8,
      height: 8,
      borderRadius: "50%",
      background: s.dot
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-display)",
      fontSize: 28,
      fontWeight: 600,
      color: "var(--text-strong)",
      lineHeight: 1
    }
  }, s.value)), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: "var(--text-muted)",
      marginTop: 6
    }
  }, s.label))));
}
function ProjectCard({
  p,
  onOpen
}) {
  const covTone = p.docStatus === "broken" ? "err" : p.docStatus === "drift" ? "warn" : "ok";
  const running = p.run.status === "running" || p.run.status === "queued";
  return /*#__PURE__*/React.createElement(Card, {
    interactive: true,
    onClick: () => onOpen(p.id),
    padding: 18
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "box",
    size: 16,
    color: "var(--text-muted)"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 15,
      fontWeight: 500,
      color: "var(--text-strong)"
    }
  }, p.name), /*#__PURE__*/React.createElement(Badge, {
    tone: p.kind === "from-scratch" ? "brass" : "neutral",
    size: "sm"
  }, p.kind)), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: "var(--text-muted)",
      marginTop: 5
    }
  }, p.desc)), /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "right",
      flex: "0 0 auto"
    }
  }, /*#__PURE__*/React.createElement(StatusPill, {
    status: p.run.status,
    size: "sm"
  }, running && p.run.phase ? p.run.phase : undefined))), /*#__PURE__*/React.createElement("div", {
    style: {
      margin: "16px 0 12px"
    }
  }, /*#__PURE__*/React.createElement(ProgressBar, {
    value: p.coverage,
    showLabel: true,
    label: "Docs \xB7 SoT",
    tone: covTone
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 14,
      fontFamily: "var(--font-mono)",
      fontSize: 11.5,
      color: "var(--text-muted)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 4
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "list-checks",
    size: 13
  }), " ", p.backlog), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 4
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "zap",
    size: 13
  }), " ", p.triggers)), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 11,
      color: "var(--text-subtle)"
    }
  }, p.activity)));
}
function ProjectsScreen({
  projects,
  runs,
  onOpen
}) {
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(StatStrip, {
    projects: projects,
    runs: runs
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "hn-eyebrow"
  }, projects.length, " projects")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(2, 1fr)",
      gap: 16
    }
  }, projects.map(p => /*#__PURE__*/React.createElement(ProjectCard, {
    key: p.id,
    p: p,
    onOpen: onOpen
  }))));
}
Object.assign(window, {
  ProjectsScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/dashboard/ProjectsScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/dashboard/RunsScreen.jsx
try { (() => {
const {
  Card,
  StatusPill,
  Badge,
  Button,
  Icon,
  Callout
} = window.HanomanDesignSystem_c639ad;
const TRIGGER_ICON = {
  commit: "git-commit-horizontal",
  schedule: "calendar-clock",
  manual: "mouse-pointer-click",
  interval: "timer"
};
function PhasePipeline({
  phases
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 0,
      flexWrap: "wrap"
    }
  }, phases.map((p, i) => {
    const c = p.state === "done" ? "var(--leaf-500)" : p.state === "active" ? "var(--brass-500)" : p.state === "failed" ? "var(--clay-500)" : "var(--bone-400)";
    const icon = p.state === "done" ? "check" : p.state === "failed" ? "x" : null;
    return /*#__PURE__*/React.createElement(React.Fragment, {
      key: p.name
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        width: 22,
        height: 22,
        borderRadius: "50%",
        background: p.state === "pending" ? "transparent" : c,
        border: p.state === "pending" ? "1.5px solid var(--bone-400)" : "none",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        animation: p.state === "active" ? "hn-pulse 1.4s ease-in-out infinite" : "none"
      }
    }, icon && /*#__PURE__*/React.createElement(Icon, {
      name: icon,
      size: 13,
      stroke: 3,
      color: "#fff"
    })), /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: "var(--font-mono)",
        fontSize: 10.5,
        color: p.state === "pending" ? "var(--text-subtle)" : "var(--text-body)",
        fontWeight: p.state === "active" ? 600 : 400
      }
    }, p.name)), i < phases.length - 1 && /*#__PURE__*/React.createElement("span", {
      style: {
        flex: 1,
        minWidth: 20,
        height: 2,
        marginTop: -18,
        background: phases[i].state === "done" ? "var(--leaf-500)" : "var(--bone-300)"
      }
    }));
  }), /*#__PURE__*/React.createElement("style", null, `@keyframes hn-pulse{0%,100%{opacity:1}50%{opacity:.4}}`));
}
function RunListRow({
  run,
  active,
  onClick
}) {
  return /*#__PURE__*/React.createElement("button", {
    onClick: onClick,
    style: {
      display: "block",
      width: "100%",
      textAlign: "left",
      cursor: "pointer",
      padding: "12px 14px",
      border: "none",
      borderLeft: `3px solid ${active ? "var(--accent)" : "transparent"}`,
      background: active ? "var(--brass-050)" : "transparent",
      borderBottom: "1px solid var(--border-hair)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 11,
      color: "var(--text-subtle)"
    }
  }, run.id), /*#__PURE__*/React.createElement(StatusPill, {
    status: run.status,
    size: "sm"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13.5,
      color: "var(--text-strong)",
      fontWeight: 500,
      marginTop: 5
    }
  }, run.title), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 6,
      marginTop: 5,
      fontFamily: "var(--font-mono)",
      fontSize: 11,
      color: "var(--text-muted)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "box",
    size: 12
  }), " ", run.project, /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--bone-400)"
    }
  }, "\xB7"), /*#__PURE__*/React.createElement(Icon, {
    name: TRIGGER_ICON[run.trigger],
    size: 12
  }), " ", run.trigger));
}
function RunDetail({
  run
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 16
    }
  }, /*#__PURE__*/React.createElement(Card, {
    padding: 20
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: 12,
      marginBottom: 20
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "hn-eyebrow",
    style: {
      marginBottom: 6
    }
  }, run.id, " \xB7 ", run.kind), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "var(--font-display)",
      fontSize: 22,
      fontWeight: 600,
      letterSpacing: "-0.02em",
      color: "var(--text-strong)"
    }
  }, run.title)), /*#__PURE__*/React.createElement(StatusPill, {
    status: run.status
  })), /*#__PURE__*/React.createElement(PhasePipeline, {
    phases: run.phases
  }), /*#__PURE__*/React.createElement("dl", {
    style: {
      margin: "22px 0 0",
      display: "grid",
      gridTemplateColumns: "auto 1fr auto 1fr",
      gap: "10px 14px",
      fontSize: 13,
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("dt", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 11,
      color: "var(--text-subtle)"
    }
  }, "project"), /*#__PURE__*/React.createElement("dd", {
    style: {
      margin: 0,
      fontFamily: "var(--font-mono)",
      color: "var(--text-strong)"
    }
  }, run.project), /*#__PURE__*/React.createElement("dt", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 11,
      color: "var(--text-subtle)"
    }
  }, "spec"), /*#__PURE__*/React.createElement("dd", {
    style: {
      margin: 0,
      fontFamily: "var(--font-mono)",
      color: "var(--text-strong)"
    }
  }, run.spec || "—"), /*#__PURE__*/React.createElement("dt", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 11,
      color: "var(--text-subtle)"
    }
  }, "trigger"), /*#__PURE__*/React.createElement("dd", {
    style: {
      margin: 0,
      display: "flex",
      alignItems: "center",
      gap: 6,
      color: "var(--text-body)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: TRIGGER_ICON[run.trigger],
    size: 13,
    color: "var(--text-muted)"
  }), " ", run.triggerDetail), /*#__PURE__*/React.createElement("dt", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 11,
      color: "var(--text-subtle)"
    }
  }, "started"), /*#__PURE__*/React.createElement("dd", {
    style: {
      margin: 0,
      color: "var(--text-body)"
    }
  }, run.startedAt))), run.status === "failed" && /*#__PURE__*/React.createElement(Callout, {
    tone: "err",
    title: "Plan blocked \u2014 docs are the Source of Truth",
    action: /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      leftIcon: "refresh-cw"
    }, "Re-scan docs & retry")
  }, "The plan can't proceed until the docs it depends on are updated. Fix the index, then re-run."), /*#__PURE__*/React.createElement("div", {
    style: {
      background: "var(--surface-code)",
      borderRadius: "var(--radius-lg)",
      border: "1px solid var(--term-line)",
      padding: 16,
      fontFamily: "var(--font-mono)",
      fontSize: 12,
      lineHeight: 1.8,
      color: "var(--term-fg)"
    }
  }, run.log.map((l, i) => /*#__PURE__*/React.createElement("div", {
    key: i
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: l.t === "✓" ? "var(--leaf-500)" : l.t === "✗" ? "var(--clay-500)" : l.t === "$" ? "var(--term-dim)" : "var(--brass-400)",
      marginRight: 8
    }
  }, l.t), /*#__PURE__*/React.createElement("span", {
    style: {
      color: l.t === "$" || l.t === " " ? "var(--term-dim)" : "var(--term-fg)"
    }
  }, l.s)))));
}
function RunsScreen({
  runs
}) {
  const [sel, setSel] = React.useState((runs.find(r => r.status === "running") || runs[0]).id);
  const active = runs.find(r => r.id === sel) || runs[0];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "320px 1fr",
      gap: 20,
      alignItems: "start"
    }
  }, /*#__PURE__*/React.createElement(Card, {
    padding: 0
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "12px 14px",
      borderBottom: "1px solid var(--border-hair)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "hn-eyebrow"
  }, "Activity \xB7 ", runs.length, " runs")), runs.map(r => /*#__PURE__*/React.createElement(RunListRow, {
    key: r.id,
    run: r,
    active: r.id === sel,
    onClick: () => setSel(r.id)
  }))), /*#__PURE__*/React.createElement(RunDetail, {
    run: active
  }));
}
Object.assign(window, {
  RunsScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/dashboard/RunsScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/dashboard/Shell.jsx
try { (() => {
const {
  Icon,
  Input,
  Button,
  IconButton,
  StatusPill
} = window.HanomanDesignSystem_c639ad;
const NAV = [{
  key: "projects",
  label: "Projects",
  icon: "layout-grid"
}, {
  key: "backlog",
  label: "Backlog",
  icon: "list-checks"
}, {
  key: "runs",
  label: "Runs",
  icon: "activity"
}, {
  key: "docs",
  label: "Docs · SoT",
  icon: "book-open"
}, {
  key: "triggers",
  label: "Triggers",
  icon: "zap"
}];
function Wordmark() {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: 26,
      height: 26,
      borderRadius: "var(--radius-sm)",
      background: "var(--accent)",
      color: "var(--ink-900)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "wind",
    size: 16,
    stroke: 2.4
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 16,
      fontWeight: 500,
      letterSpacing: "-0.01em",
      color: "var(--text-strong)"
    }
  }, "hanoman"));
}
function SidebarItem({
  item,
  active,
  onClick
}) {
  const [hover, setHover] = React.useState(false);
  const on = active === item.key;
  return /*#__PURE__*/React.createElement("button", {
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      width: "100%",
      padding: "8px 10px",
      border: "none",
      cursor: "pointer",
      borderRadius: "var(--radius-sm)",
      textAlign: "left",
      background: on ? "var(--brass-100)" : hover ? "var(--bone-200)" : "transparent",
      color: on ? "var(--brass-700)" : "var(--text-body)",
      fontFamily: "var(--font-ui)",
      fontSize: "var(--text-md)",
      fontWeight: on ? "var(--weight-semibold)" : "var(--weight-medium)",
      transition: "var(--transition-fast)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: item.icon,
    size: 17,
    color: on ? "var(--accent-hover)" : "var(--text-muted)"
  }), item.label);
}
function Shell({
  active,
  onNav,
  title,
  breadcrumb,
  actions,
  showSearch = true,
  query,
  onSearch,
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      height: "100%",
      background: "var(--surface-page)",
      color: "var(--text-body)"
    }
  }, /*#__PURE__*/React.createElement("aside", {
    style: {
      width: "var(--sidebar-w)",
      flex: "0 0 auto",
      display: "flex",
      flexDirection: "column",
      borderRight: "1px solid var(--border-hair)",
      background: "var(--bone-100)",
      padding: "18px 14px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "2px 6px 20px"
    }
  }, /*#__PURE__*/React.createElement(Wordmark, null)), /*#__PURE__*/React.createElement("div", {
    className: "hn-eyebrow",
    style: {
      padding: "0 10px 8px"
    }
  }, "Workspace"), /*#__PURE__*/React.createElement("nav", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 2
    }
  }, NAV.map(n => /*#__PURE__*/React.createElement(SidebarItem, {
    key: n.key,
    item: n,
    active: active,
    onClick: () => onNav(n.key)
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: "auto",
      paddingTop: 16,
      borderTop: "1px solid var(--border-hair)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "6px 8px"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 28,
      height: 28,
      borderRadius: "50%",
      flex: "0 0 auto",
      background: "var(--wind-100)",
      color: "var(--wind-700)",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "var(--font-mono)",
      fontSize: 12,
      fontWeight: 600
    }
  }, "An"), /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: "var(--text-strong)",
      fontWeight: 500
    }
  }, "Anjani"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 10,
      color: "var(--text-subtle)"
    }
  }, "6 projects watched"))))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0,
      display: "flex",
      flexDirection: "column"
    }
  }, /*#__PURE__*/React.createElement("header", {
    style: {
      height: "var(--topbar-h)",
      flex: "0 0 auto",
      display: "flex",
      alignItems: "center",
      gap: 16,
      padding: "0 22px",
      borderBottom: "1px solid var(--border-hair)",
      background: "color-mix(in srgb, var(--bone-100) 80%, transparent)",
      backdropFilter: "blur(8px)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, breadcrumb && /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 11,
      color: "var(--text-subtle)",
      marginBottom: 1
    }
  }, breadcrumb), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "var(--font-display)",
      fontSize: 19,
      fontWeight: 600,
      letterSpacing: "-0.02em",
      color: "var(--text-strong)",
      lineHeight: 1.1
    }
  }, title)), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }), showSearch && /*#__PURE__*/React.createElement(Input, {
    placeholder: "Search projects\u2026",
    leftIcon: "search",
    size: "sm",
    style: {
      width: 240
    },
    value: query || "",
    onChange: e => onSearch && onSearch(e.target.value)
  }), actions), /*#__PURE__*/React.createElement("main", {
    style: {
      flex: 1,
      minHeight: 0,
      overflow: "auto"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: "var(--content-max)",
      margin: "0 auto",
      padding: "26px 28px 48px"
    }
  }, children))));
}
Object.assign(window, {
  Shell
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/dashboard/Shell.jsx", error: String((e && e.message) || e) }); }

// ui_kits/dashboard/TriggersScreen.jsx
try { (() => {
const {
  Card,
  Badge,
  Switch,
  Icon,
  Button
} = window.HanomanDesignSystem_c639ad;
const TRIGGER_META = {
  commit: {
    icon: "git-commit-horizontal",
    label: "On commit",
    blurb: "Fires when code is pushed to a watched branch."
  },
  schedule: {
    icon: "calendar-clock",
    label: "Scheduled",
    blurb: "Runs at a fixed time (cron)."
  },
  manual: {
    icon: "mouse-pointer-click",
    label: "Manual",
    blurb: "A human kicks it off on demand."
  },
  interval: {
    icon: "timer",
    label: "Interval",
    blurb: "Repeats every N minutes/hours."
  }
};
function TypeLegend() {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(4, 1fr)",
      gap: 12,
      marginBottom: 22
    }
  }, Object.entries(TRIGGER_META).map(([k, m]) => /*#__PURE__*/React.createElement(Card, {
    key: k,
    padding: 14
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      marginBottom: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 28,
      height: 28,
      borderRadius: "var(--radius-sm)",
      background: "var(--brass-100)",
      color: "var(--brass-700)",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: m.icon,
    size: 15
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13.5,
      fontWeight: 600,
      color: "var(--text-strong)"
    }
  }, m.label)), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: "var(--text-muted)",
      lineHeight: 1.45
    }
  }, m.blurb))));
}
function TriggerRow({
  t,
  onToggle
}) {
  const m = TRIGGER_META[t.type];
  const [on, setOn] = React.useState(t.enabled);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 14,
      padding: "14px 16px",
      borderBottom: "1px solid var(--border-hair)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 32,
      height: 32,
      borderRadius: "var(--radius-sm)",
      background: "var(--bone-200)",
      color: "var(--text-muted)",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      flex: "0 0 auto"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: m.icon,
    size: 16
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0,
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 13,
      color: "var(--text-strong)",
      fontWeight: 500
    }
  }, t.project), /*#__PURE__*/React.createElement(Badge, {
    tone: "neutral",
    size: "sm"
  }, m.label)), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 11.5,
      color: "var(--text-muted)",
      marginTop: 3
    }
  }, t.detail)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 7,
      marginRight: 6
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "arrow-right",
    size: 13,
    color: "var(--text-subtle)"
  }), /*#__PURE__*/React.createElement(Badge, {
    tone: "brass",
    size: "sm"
  }, t.target)), /*#__PURE__*/React.createElement(Switch, {
    checked: on,
    onChange: v => {
      setOn(v);
      onToggle && onToggle(t.id, v);
    }
  }));
}
function TriggersScreen({
  triggers
}) {
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(TypeLegend, null), /*#__PURE__*/React.createElement(Card, {
    padding: 0
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "14px 16px",
      borderBottom: "1px solid var(--border-hair)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "hn-eyebrow"
  }, "Automation \xB7 ", triggers.length, " triggers"), /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    leftIcon: "plus"
  }, "New trigger")), /*#__PURE__*/React.createElement("div", null, triggers.map(t => /*#__PURE__*/React.createElement(TriggerRow, {
    key: t.id,
    t: t
  })))));
}
Object.assign(window, {
  TriggersScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/dashboard/TriggersScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/dashboard/data.js
try { (() => {
// Mock data for the Hanoman dashboard — nafanesia.id's Claude Code
// orchestrator. Docs-driven workflow: brainstorm → objective → spec →
// plan → execute, monitored across every project.
window.HN_DATA = {
  projects: [{
    id: "sembada",
    name: "sembada",
    desc: "SME invoicing & tax SaaS",
    kind: "from-scratch",
    stack: "Next.js · Postgres",
    docStatus: "drift",
    coverage: 62,
    run: {
      status: "running",
      phase: "Doc index",
      kind: "scaffold"
    },
    backlog: 4,
    triggers: 2,
    activity: "building docs · now"
  }, {
    id: "arta",
    name: "arta",
    desc: "Payments & wallet ledger",
    kind: "existing",
    stack: "Go · Postgres",
    docStatus: "ok",
    coverage: 94,
    run: {
      status: "running",
      phase: "Execute",
      kind: "feature"
    },
    backlog: 6,
    triggers: 3,
    activity: "executing spec · 2m"
  }, {
    id: "loka-pos",
    name: "loka-pos",
    desc: "Retail POS + inventory",
    kind: "existing",
    stack: "TypeScript · SQLite",
    docStatus: "drift",
    coverage: 71,
    run: {
      status: "queued",
      phase: "Audit",
      kind: "qa"
    },
    backlog: 3,
    triggers: 1,
    activity: "queued · 5m"
  }, {
    id: "wanara",
    name: "wanara",
    desc: "Internal ops admin",
    kind: "existing",
    stack: "Python · Postgres",
    docStatus: "ok",
    coverage: 100,
    run: {
      status: "idle",
      phase: null,
      kind: null
    },
    backlog: 1,
    triggers: 2,
    activity: "idle · 3h"
  }, {
    id: "candra",
    name: "candra",
    desc: "Product analytics",
    kind: "existing",
    stack: "TypeScript · ClickHouse",
    docStatus: "broken",
    coverage: 38,
    run: {
      status: "failed",
      phase: "Plan",
      kind: "qa"
    },
    backlog: 5,
    triggers: 1,
    activity: "plan failed · 26m"
  }, {
    id: "gapura",
    name: "gapura",
    desc: "API gateway & auth",
    kind: "from-scratch",
    stack: "Rust · Redis",
    docStatus: "ok",
    coverage: 88,
    run: {
      status: "done",
      phase: "Execute",
      kind: "feature"
    },
    backlog: 2,
    triggers: 4,
    activity: "shipped · 1h"
  }],
  // Backlog — specs produced by hanoman from human briefs / QA findings.
  backlog: [{
    id: "SPEC-142",
    project: "arta",
    title: "Multi-currency wallet balances",
    source: "brief",
    stage: "planned",
    author: "Rangga",
    objective: "Hold and display balances per currency with FX at display time."
  }, {
    id: "SPEC-141",
    project: "candra",
    title: "Funnel drop-off double-counts sessions",
    source: "qa",
    stage: "spec-ready",
    author: "QA · Dinda",
    objective: "Sessions crossing UTC midnight counted twice in funnel step 3."
  }, {
    id: "SPEC-140",
    project: "sembada",
    title: "Recurring invoice schedules",
    source: "brief",
    stage: "brainstorming",
    author: "Rangga",
    objective: "— clarifying cadence, proration, and dunning before spec."
  }, {
    id: "SPEC-139",
    project: "loka-pos",
    title: "Offline sync conflict on stock counts",
    source: "qa",
    stage: "objective",
    author: "QA · Bima",
    objective: "Two terminals editing the same SKU offline overwrite silently."
  }, {
    id: "SPEC-138",
    project: "arta",
    title: "Webhook retry with backoff",
    source: "brief",
    stage: "executing",
    author: "Rangga",
    objective: "Exponential backoff + dead-letter after 6 attempts."
  }, {
    id: "SPEC-137",
    project: "gapura",
    title: "Rotate signing keys without downtime",
    source: "brief",
    stage: "done",
    author: "Sekar",
    objective: "Dual-key window; old key valid for 24h after rotation."
  }],
  // Claude Code runs — the spec → plan → execute lifecycle.
  runs: [{
    id: "RUN-8842",
    project: "arta",
    spec: "SPEC-138",
    title: "Webhook retry with backoff",
    kind: "feature",
    status: "running",
    trigger: "commit",
    triggerDetail: "push → main",
    startedAt: "2m ago",
    progress: 68,
    phases: [{
      name: "Brainstorm",
      state: "done"
    }, {
      name: "Objective",
      state: "done"
    }, {
      name: "Spec",
      state: "done"
    }, {
      name: "Plan",
      state: "done"
    }, {
      name: "Execute",
      state: "active"
    }],
    log: [{
      t: "$",
      s: "hanoman execute SPEC-138 --project arta"
    }, {
      t: "›",
      s: "plan loaded · 7 steps"
    }, {
      t: "✓",
      s: "step 4/7 · retry queue wired"
    }, {
      t: "›",
      s: "step 5/7 · dead-letter table…"
    }]
  }, {
    id: "RUN-8841",
    project: "sembada",
    spec: null,
    title: "Scaffold docs from MVP objective",
    kind: "scaffold",
    status: "running",
    trigger: "manual",
    triggerDetail: "Rangga",
    startedAt: "just now",
    progress: 40,
    phases: [{
      name: "Brainstorm",
      state: "done"
    }, {
      name: "Objective",
      state: "done"
    }, {
      name: "Doc index",
      state: "active"
    }],
    log: [{
      t: "$",
      s: "hanoman scaffold --project sembada"
    }, {
      t: "✓",
      s: "MVP objective locked"
    }, {
      t: "›",
      s: "writing internal/docs/** · 14/34"
    }]
  }, {
    id: "RUN-8838",
    project: "candra",
    spec: "SPEC-141",
    title: "Audit funnel double-count",
    kind: "qa",
    status: "failed",
    trigger: "schedule",
    triggerDetail: "nightly 02:00",
    startedAt: "26m ago",
    progress: 55,
    phases: [{
      name: "Audit",
      state: "done"
    }, {
      name: "Spec",
      state: "done"
    }, {
      name: "Plan",
      state: "failed"
    }, {
      name: "Execute",
      state: "pending"
    }],
    log: [{
      t: "$",
      s: "hanoman qa SPEC-141 --project candra"
    }, {
      t: "✗",
      s: "plan blocked · data-model.md missing session TZ"
    }, {
      t: " ",
      s: "exit 1 · docs are stale (SoT)"
    }]
  }, {
    id: "RUN-8835",
    project: "gapura",
    spec: "SPEC-137",
    title: "Rotate signing keys",
    kind: "feature",
    status: "done",
    trigger: "interval",
    triggerDetail: "every 6h",
    startedAt: "1h ago",
    progress: 100,
    phases: [{
      name: "Brainstorm",
      state: "done"
    }, {
      name: "Objective",
      state: "done"
    }, {
      name: "Spec",
      state: "done"
    }, {
      name: "Plan",
      state: "done"
    }, {
      name: "Execute",
      state: "done"
    }],
    log: [{
      t: "$",
      s: "hanoman execute SPEC-137 --project gapura"
    }, {
      t: "✓",
      s: "all 9 steps · tests green"
    }, {
      t: "✓",
      s: "docs updated · index in sync"
    }]
  }],
  triggers: [{
    id: "t1",
    project: "arta",
    type: "commit",
    detail: "push → main",
    target: "plan + execute",
    enabled: true
  }, {
    id: "t2",
    project: "arta",
    type: "schedule",
    detail: "nightly 02:00",
    target: "audit",
    enabled: true
  }, {
    id: "t3",
    project: "sembada",
    type: "manual",
    detail: "on demand",
    target: "scaffold docs",
    enabled: true
  }, {
    id: "t4",
    project: "candra",
    type: "schedule",
    detail: "nightly 02:00",
    target: "qa audit",
    enabled: false
  }, {
    id: "t5",
    project: "gapura",
    type: "interval",
    detail: "every 6h",
    target: "plan + execute",
    enabled: true
  }, {
    id: "t6",
    project: "loka-pos",
    type: "commit",
    detail: "push → develop",
    target: "audit",
    enabled: true
  }],
  // internal/docs — Source of Truth. Fixed category vocabulary.
  docTree: [{
    cat: "entrypoints",
    files: ["blueprint.md", "brd.md", "prd.md", "frd.md", "rd.md"],
    linked: true
  }, {
    cat: "product",
    files: ["blueprint.md", "scope-principles.md", "onboarding.md"],
    linked: true
  }, {
    cat: "business",
    files: ["brd.md", "pricing-rationale.md"],
    linked: true
  }, {
    cat: "requirements",
    files: ["prd.md", "frd.md", "rd.md", "acceptance-criteria-ears-standard.md"],
    linked: true
  }, {
    cat: "research",
    files: ["market-sizing.md", "competitor-analysis.md", "moat.md"],
    linked: false
  }, {
    cat: "architecture",
    files: ["stack.md", "data-model.md", "api-contract.md", "nfr.md"],
    linked: true
  }, {
    cat: "adr",
    files: ["0001-ledger-events.md", "0002-fx-provider.md"],
    linked: true
  }, {
    cat: "operations",
    files: ["roadmap.md", "gtm.md", "agent-documentation-workflow.md"],
    linked: true
  }, {
    cat: "security",
    files: ["security-standard.md"],
    linked: true
  }, {
    cat: "brand",
    files: ["brand-strategy.md", "color.md", "pattern-system.md"],
    linked: false
  }, {
    cat: "frontend",
    files: ["frontend-implementation.md"],
    linked: true
  }, {
    cat: "design-system",
    files: ["design-system.md", "implementation-plan.md"],
    linked: true
  }]
};
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/dashboard/data.js", error: String((e && e.message) || e) }); }

__ds_ns.Icon = __ds_scope.Icon;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Callout = __ds_scope.Callout;

__ds_ns.ProgressBar = __ds_scope.ProgressBar;

__ds_ns.StatusPill = __ds_scope.StatusPill;

__ds_ns.Tooltip = __ds_scope.Tooltip;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Checkbox = __ds_scope.Checkbox;

__ds_ns.IconButton = __ds_scope.IconButton;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.Select = __ds_scope.Select;

__ds_ns.Switch = __ds_scope.Switch;

__ds_ns.Tabs = __ds_scope.Tabs;

__ds_ns.Card = __ds_scope.Card;

})();
