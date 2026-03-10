module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["'Press Start 2P'", "system-ui", "sans-serif"]
      },
      colors: {
        game: {
          bg: "#1a1a2e",
          panel: "#2d2d44",
          panelHover: "#3d3d5c",
          accent: "#fbbf24",
          accentLight: "#fcd34d",
          accentDark: "#d97706",
          danger: "#dc2626",
          dangerHover: "#b91c1c",
          success: "#22c55e",
          muted: "#9ca3af"
        }
      },
      borderRadius: {
        game: "6px",
        gameLg: "8px"
      },
      boxShadow: {
        game: "0 2px 0 rgba(251, 191, 36, 0.2)",
        gameHover: "0 3px 8px rgba(251, 191, 36, 0.25)",
        gameInner: "inset 0 1px 2px rgba(0, 0, 0, 0.3)",
        panel: "0 4px 12px rgba(0, 0, 0, 0.3)",
        panelFocus: "0 0 0 3px rgba(251, 191, 36, 0.25)"
      },
      transitionDuration: {
        150: "150ms",
        200: "200ms"
      }
    }
  },
  plugins: []
};
