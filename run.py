"""Entry point for the Trading App."""
import os
import uvicorn

if __name__ == "__main__":
    port = int(os.getenv("PORT", "8002"))
    host = os.getenv("HOST", "127.0.0.1")
    reload = os.getenv("ENV", "dev") == "dev"
    uvicorn.run("backend.app:app", host=host, port=port, reload=reload)
