# Architecture

The runnable release uses a modular Node.js API gateway with clear domain routes and JSON persistence so it can run immediately in Termux, Windows, Linux, Docker, or a small cloud service without installing packages.

For production, replace the JSON repository with PostgreSQL using the migration blueprint. Keep the REST API contracts stable. High-volume domains can then be extracted into services without rewriting the web application.
