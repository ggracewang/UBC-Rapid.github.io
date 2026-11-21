// Reads and updates src/siteConfig.json for the Site settings issue form.
//
//   --pinned-issue  Writes the text of the pinned "📌 Site settings" issue: a
//                   table of the current settings and an "Edit site settings"
//                   link that opens the form with every box filled in.
//   --from-issue    Reads a submitted form from ISSUE_BODY and saves any
//                   changes to siteConfig.json. Nothing is saved if any box
//                   has a problem.
//   --show          Prints the current settings.
//
// With no option, the values are read from SETTING_ environment variables
// instead (SETTING_INSTAGRAM, etc.), which is handy for testing on your
// computer: set one and run `node .github/scripts/update-site-config.js`.

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', '..', 'src', 'siteConfig.json');
const FORM_TEMPLATE = 'site-settings.yml';
const FORM_TITLE = 'Update site settings';

// Every box on the form. Each label must match the label in
// .github/ISSUE_TEMPLATE/site-settings.yml, and each id must match its id.
// `site` limits a box to one website, so a link can't be pasted into the
// wrong social media box.
const APPLICATIONS = { id: 'applications', env: 'SETTING_APPLICATIONS', label: 'Applications (Join Us page)' };
const YEAR = { id: 'application_year', env: 'SETTING_APPLICATION_YEAR', label: 'Application year (Join Us page)' };
const LINKS = [
    { id: 'application_form', env: 'SETTING_APPLICATION_FORM', key: 'applicationForm', label: 'Application form link (Join Us page)' },
    { id: 'modelling_form', env: 'SETTING_MODELLING_FORM', key: 'modellingForm', label: 'Request Now form link (Modelling Service page)' },
    { id: 'facebook', env: 'SETTING_FACEBOOK', key: 'facebook', label: 'Facebook link (footer)', site: 'facebook.com' },
    { id: 'instagram', env: 'SETTING_INSTAGRAM', key: 'instagram', label: 'Instagram link (footer)', site: 'instagram.com' },
    { id: 'linkedin', env: 'SETTING_LINKEDIN', key: 'linkedin', label: 'LinkedIn link (footer)', site: 'linkedin.com' },
    { id: 'linktree', env: 'SETTING_LINKTREE', key: 'linktree', label: 'Contact Us / Linktree link (home page)' },
    { id: 'sponsorship_package', env: 'SETTING_SPONSORSHIP_PACKAGE', key: 'sponsorshipPackage', label: 'Sponsorship Package link (home page)' },
    { id: 'donate_organizations', env: 'SETTING_DONATE_ORGANIZATIONS', key: 'donateOrganizations', label: 'Donation link for organizations (home page)' },
    { id: 'donate_individuals', env: 'SETTING_DONATE_INDIVIDUALS', key: 'donateIndividuals', label: 'Donation link for individuals (home page)' },
];
const FIELDS = [APPLICATIONS, YEAR, ...LINKS];

function readConfig() {
    const text = fs.readFileSync(CONFIG_PATH, 'utf8');
    return { text, config: JSON.parse(text) };
}

function describeOpen(isOpen) {
    return isOpen ? 'Open' : 'Closed';
}

// Every setting in the order the form shows them, with its current value
function currentValues(config) {
    return {
        [APPLICATIONS.id]: describeOpen(config.applicationsOpen),
        [YEAR.id]: config.applicationYear,
        ...Object.fromEntries(LINKS.map((field) => [field.id, config.links[field.key]])),
    };
}

// Returns the link with https:// at the start, or throws an error explaining
// what's wrong with it.
function cleanLink(value, { label, site }) {
    if (/\s/.test(value)) {
        throw new Error(`${label} can't contain spaces.`);
    }

    let link;
    if (/^https?:\/\//i.test(value)) {
        link = value.replace(/^https?:\/\//i, 'https://');
    } else if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
        // Some other kind of address, like mailto: or ftp:
        throw new Error(`${label} doesn't look like a web address.`);
    } else {
        link = `https://${value}`;
    }

    let hostname;
    try {
        hostname = new URL(link).hostname;
    } catch {
        throw new Error(`${label} doesn't look like a web address.`);
    }
    if (!hostname.includes('.') || hostname.startsWith('.') || hostname.endsWith('.')) {
        throw new Error(`${label} doesn't look like a web address.`);
    }
    if (site && hostname !== site && !hostname.endsWith(`.${site}`)) {
        throw new Error(`${label} must be a link to ${site}.`);
    }
    return link;
}

// The year must look like 2027/28, with the second year right after the first.
function cleanYear(value) {
    const match = value.match(/^(\d{4})\/(\d{2})$/);
    if (!match || Number(match[2]) !== (Number(match[1]) + 1) % 100) {
        throw new Error(`${YEAR.label} must look like 2027/28.`);
    }
    return value;
}

// Stops a | in a value from breaking a Markdown table.
function tableCell(value) {
    return String(value).replace(/\|/g, '\\|');
}

function settingsTable(config) {
    const values = currentValues(config);
    return [
        '| Setting | Current value |',
        '| --- | --- |',
        ...FIELDS.map((field) => `| ${field.label} | ${tableCell(values[field.id])} |`),
    ].join('\n');
}

function changesTable(changes) {
    return [
        '| Setting | Old | New |',
        '| --- | --- | --- |',
        ...changes.map((c) => `| ${c.label} | ${tableCell(c.old)} | ${tableCell(c.new)} |`),
    ].join('\n');
}

function setOutput(name, value) {
    if (process.env.GITHUB_OUTPUT) {
        fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
    }
}

function writeFileIfSet(envName, text) {
    if (process.env[envName]) {
        fs.writeFileSync(process.env[envName], text);
    }
}

// Reads a submitted issue form. GitHub writes each box as a "### Label"
// heading followed by its value, or "_No response_" if it was left empty.
function readIssueForm(body) {
    const values = {};
    const sections = `\n${body.replace(/\r\n/g, '\n')}`.split(/\n### /).slice(1);
    for (const section of sections) {
        const [heading, ...rest] = section.split('\n');
        const field = FIELDS.find((f) => f.label === heading.trim());
        if (field) {
            const value = rest.join('\n').trim();
            values[field.id] = value === '_No response_' ? '' : value;
        }
    }
    return values;
}

function readEnvironment() {
    return Object.fromEntries(FIELDS.map((field) => [field.id, (process.env[field.env] || '').trim()]));
}

// Compares the submitted values with the current settings and applies the
// ones that changed. Empty values keep the current setting.
function applyChanges(config, values) {
    const changes = [];
    const problems = [];

    const open = (values[APPLICATIONS.id] || '').trim();
    if (open) {
        const isOpen = { open: true, closed: false }[open.toLowerCase()];
        if (isOpen === undefined) {
            problems.push(`${APPLICATIONS.label} must be Open or Closed.`);
        } else if (isOpen !== config.applicationsOpen) {
            changes.push({ label: APPLICATIONS.label, old: describeOpen(config.applicationsOpen), new: describeOpen(isOpen) });
            config.applicationsOpen = isOpen;
        }
    }

    const year = (values[YEAR.id] || '').trim();
    if (year) {
        try {
            const cleaned = cleanYear(year);
            if (cleaned !== config.applicationYear) {
                changes.push({ label: YEAR.label, old: config.applicationYear, new: cleaned });
                config.applicationYear = cleaned;
            }
        } catch (error) {
            problems.push(error.message);
        }
    }

    for (const field of LINKS) {
        const value = (values[field.id] || '').trim();
        if (!value) {
            continue;
        }
        try {
            const cleaned = cleanLink(value, field);
            if (cleaned !== config.links[field.key]) {
                changes.push({ label: field.label, old: config.links[field.key], new: cleaned });
                config.links[field.key] = cleaned;
            }
        } catch (error) {
            problems.push(error.message);
        }
    }

    return { changes, problems };
}

// Keeps the file's line endings and the blank lines at the end, so the pull
// request only shows the settings that changed
function saveConfig(originalText, config) {
    const lineEnding = originalText.includes('\r\n') ? '\r\n' : '\n';
    const fileEnding = originalText.match(/\s*$/)[0];
    const json = JSON.stringify(config, null, 2).replace(/\n/g, lineEnding);
    fs.writeFileSync(CONFIG_PATH, json + fileEnding);
}

// The link that opens the form with every box filled in with its current value
function editLink(config) {
    const server = process.env.GITHUB_SERVER_URL || 'https://github.com';
    const repository = process.env.GITHUB_REPOSITORY || 'UBC-Rapid/UBC-Rapid.github.io';
    const params = new URLSearchParams({ template: FORM_TEMPLATE, title: FORM_TITLE, ...currentValues(config) });
    return `${server}/${repository}/issues/new?${params}`;
}

function pinnedIssue() {
    const { config } = readConfig();
    console.log([
        '## ✏️ [Edit site settings](' + editLink(config) + ')',
        '',
        'Opens a form with every box already filled in with the current value. Change only what you want and submit it. A pull request with your changes is opened automatically for someone to review.',
        '',
        '## Current site settings',
        '',
        settingsTable(config),
        '',
        '_This issue updates itself whenever the settings change on main. After a settings pull request is merged, run **Deploy to GitHub Pages** in the Actions tab to update the live site._',
    ].join('\n'));
}

function show() {
    const { config } = readConfig();
    console.log(['## Current site settings', '', settingsTable(config)].join('\n'));
}

// Shared by --from-issue and testing with environment variables
function update(values) {
    const { text, config } = readConfig();
    const before = JSON.parse(text);
    const { changes, problems } = applyChanges(config, values);
    const tryAgain = 'To try again, go to the pinned **📌 Site settings** issue and click **Edit site settings**.';

    if (problems.length > 0) {
        const message = [
            '❌ **Nothing was changed.** Please fix:',
            '',
            ...problems.map((problem) => `- ${problem}`),
            '',
            tryAgain,
        ].join('\n');
        console.log(message);
        writeFileIfSet('COMMENT_FILE', message);
        setOutput('result', 'problems');
        process.exitCode = 1;
        return;
    }

    if (changes.length === 0) {
        const message = [
            'Nothing to change: everything in the form already matches the current settings.',
            '',
            '### Current site settings',
            '',
            settingsTable(before),
        ].join('\n');
        console.log(message);
        writeFileIfSet('COMMENT_FILE', message);
        setOutput('result', 'unchanged');
        return;
    }

    saveConfig(text, config);
    const table = changesTable(changes);
    console.log(['✅ Settings updated:', '', table].join('\n'));
    writeFileIfSet('CHANGES_FILE', table);
    setOutput('result', 'changed');

    const requestedBy = process.env.REQUESTED_BY ? ` by @${process.env.REQUESTED_BY}` : '';
    const issue = process.env.ISSUE_NUMBER ? ` in #${process.env.ISSUE_NUMBER}` : '';
    writeFileIfSet('PR_BODY_FILE', [
        `Requested${requestedBy}${issue} using the **Update site settings** form.`,
        '',
        table,
        '',
        'Before merging, click each new link to check it goes to the right page.',
        'After merging, run **Deploy to GitHub Pages** to update the live site.',
    ].join('\n'));
}

if (process.argv.includes('--pinned-issue')) {
    pinnedIssue();
} else if (process.argv.includes('--show')) {
    show();
} else if (process.argv.includes('--from-issue')) {
    update(readIssueForm(process.env.ISSUE_BODY || ''));
} else {
    update(readEnvironment());
}
