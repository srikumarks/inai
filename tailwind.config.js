module.exports = {
    purge: {
        enabled: true,
        content: [
            "./services/**/*.html",
            "./services/**/*.css",
            "./services/**/*.js",
            "./src/*.js",
            "./src/*.css",
        ],
    },
    darkMode: false, // or 'media' or 'class'
    theme: {
        extend: {},
    },
    variants: {
        extend: {},
    },
    plugins: [
        require("@tailwindcss/typography"),
        require("@tailwindcss/forms"),
        require("@tailwindcss/line-clamp"),
    ],
};
