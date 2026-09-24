const { defineConfig } = require('@playwright/test');

const PORT = 8123;

module.exports = defineConfig({
    testDir: '.',
    testMatch: '*.spec.js',
    outputDir: 'resultats/details',
    timeout: 30000,
    retries: process.env.CI ? 1 : 0,
    workers: process.env.CI ? 2 : 4,
    reporter: [
        ['list'],
        ['html', { outputFolder: 'resultats/rapport', open: 'never' }],
        ['./compte-rendu.js'],
    ],
    use: {
        baseURL: `http://localhost:${PORT}/`,
        locale: 'fr-FR',
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
    },
    projects: [
        { name: 'ordinateur', use: { browserName: 'chromium', viewport: { width: 1366, height: 768 } } },
        { name: 'téléphone', use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    ],
    webServer: {
        command: `node serveur-statique.js ${PORT}`,
        url: `http://localhost:${PORT}/login.html`,
        reuseExistingServer: !process.env.CI,
    },
});
