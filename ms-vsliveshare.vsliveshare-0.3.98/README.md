# Microsoft Visual Studio Live Share

Visual Studio Live Share enables you to achieve greater confidence at speed by streamlining collaborative editing, debugging, and more in real-time during development. You get real-time sharing in tools you love. You can share the full context of your code, collaboratively edit while still navigating files independently, securely share local servers, and even collaboratively debug while still retaining the ability to inspect on your own.

[Learn more!](https://aka.ms/vsls)

> **Note: Visual Studio Live Share is currently in preview. Features and user experience is not final.**

## Installation

Getting going with the extension for Visual Studio Code is simple. Just follow these steps:

1. Install [Visual Studio Code](https://code.visualstudio.com/) for Windows (7, 8.1, or 10) or macOS **(Sierra+ only)**, or 64-bit Linux **([see details](https://aka.ms/vsls-docs/linux-setup))**.
2. Download and install the Visual Studio Live Share extension for Visual Studio Code.
3. Wait for the extension to download and reload when prompted.
4. Wait for Live Share to finish installing dependencies.
5. **Linux**: If you see a notification about installing [missing libraries](https://aka.ms/vsls-docs/linux-prerequisites):
    1. Click "Install" in the notification.
    2. Enter your admin (sudo) password when prompted.
    3. Restart VS Code when done.
6. The "Sign in" and "Share" status bar items will appear once done.

By downloading and using Visual Studio Live Share, you agree to the [license terms](https://aka.ms/vsls-license) and [privacy statement](https://www.microsoft.com/en-us/privacystatement/EnterpriseDev/default.aspx). See [troubeshooting](https://aka.ms/vsls-troubleshooting) if you run into problems.

[Learn more!](https://aka.ms/vsls-dl)

## Quickstart

>**Tip:** Did you know you can *join your own collaboration session*? This allows you to try Live Share on your own or to spin up a instance of VS or VS Code and connect to it remotely! You can even use the same identity on both instances. Check it out!

All collaboration activities in Visual Studio Live Share involves a single "host" and one or more "guests." Hosts "share" content, debugging sessions, and more by starting a "collaboration session" that guests then "join."

### Share

After installing, follow these steps to start a collaboration session and share a folder from VS Code:

1. Click the "Sign in" status bar item.
2. A browser window will appear where you should then sign in.
3. **Linux**: Paste the user code in Visual Studio Code.
    1. Click on the link that appears at the bottom of the "Ready to collaborate" page.
    2. Copy the "user code" that appears.
    3. Paste it into the input field in VS Code and hit enter.
4. Feel free to close the browser tab when done.
5. Open a folder you want to share.
6. Click the "Share" status bar item and an invite link will be automatically copied to your clipboard.
7. Send the link to someone!

> **Note:** You may be asked by your desktop firewall software to allow the Live Share agent to open a port the first time you share. Accepting this is entirely optional but enables a secured "direct mode" to improve performance when the person you are working with is on the same network as you are. See [changing the connection mode](https://aka.ms/vsls-docs/connection-mode) for details.

When the link is opened in a browser, it allows others to join your collaboration session and download the needed extensions.

[Learn more!](https://aka.ms/vsls-docs/share)

### Join

Joining a collaboration session is easy! After installing, follow these steps:

1. Click the "Sign in" status bar item.
2. A browser window will appear where you should then sign in.
3. **Linux**: Paste the user code in Visual Studio Code.
    1. Click on the link that appears at the bottom of the "Ready to collaborate" page.
    2. Copy the "user code" that appears.
    3. Paste it into the input field in VS Code and hit enter.
4. Feel free to close the browser tab when done.
5. Open (or re-open) the invite web page using the invite link your colleague sent you.
6. You should be notified that your browser wants to launch VS Code.
7. After allowing this to happen, VS Code will start and automatically join the collaboration session.
8. That's it! VS Code will then join the collaboration session!

See [joining manually](https://aka.ms/vsls-docs/manual-join) in the docs for alternatives if clicking the link is not working.

[Learn more!](https://aka.ms/vsls-docs/join)

### What next?

You can now:

- Co-edit
- Co-debug
- Share a server
- Share a terminal
- More!

[Learn more!](http://aka.ms/vsls-docs/vscode)

## More Information

- [Documentation](https://aka.ms/vsls-docs)
- [Visual Studio Live Share Site](https://aka.ms/vsls)
- [Visual Studio Live Share FAQ](https://aka.ms/vsls-faq)
- [Report a Problem](https://aka.ms/vsls-problem)
- [Contact Us](https://aka.ms/vsls-support)
- [License](https://aka.ms/vsls-license)