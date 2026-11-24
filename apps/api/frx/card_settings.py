"""The card's settings as its functions read them: no provider credentials, and every model
connection pointed at the server's profiles.

The engine runs the old page's functions (apps/engine); their requests to the page's server go to
the engine's host (/host/…), which the server answers in process (frx.play_prompt.answerer,
frx.play_jobs). Settings read from the store pass through browser_setting, so whatever address a
saved setting carries, the functions call the host's.
"""

import re

# Where the engine's page functions reach the server (see the module's description).
HOST = "/host"
SECRET = re.compile(
    r"(?:.*api[_-]?key|authorization|access[_-]?token|secret[_-]?key|password|token)$", re.I
)
PROFILE_KEYS = {
    "CULTIVATION_THINKING_API_CONFIG_V1": "variables",
    "CULTIVATION_SUMMARY_CONFIG_V1": "summary",
    "CULTIVATION_IMAGE_TAGGING_API_CONFIG_V1": "optimization",
    "CULTIVATION_WORLD_EVOLUTION_API_CONFIG_V1": "evolution",
    "CULTIVATION_KNOWLEDGE_SEARCH_API_CONFIG_V2": "archive",
}


def without_credentials(value, *, browser=False):
    if isinstance(value, list):
        return [without_credentials(item, browser=browser) for item in value]
    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            if isinstance(key, str) and SECRET.fullmatch(key):
                if browser:
                    result[key] = False if isinstance(item, bool) else "server-managed"
            elif (
                browser
                and isinstance(key, str)
                and key.lower().endswith(("apiurl", "api_url", "apiendpoint", "api_endpoint"))
            ):
                result[key] = HOST + "/profiles/default"
            else:
                result[key] = without_credentials(item, browser=browser)
        return result
    return value


def browser_setting(value):
    result = without_credentials(value, browser=True)
    key = result.get("key", "")
    content = result.get("value")
    if key == "CULTIVATION_WORKSHOP_KEY_V1":
        result["value"] = ""
    if isinstance(content, dict):
        if key == "CULTIVATION_NPC_DISPLAY_SETTINGS_V1" and not content.get("showAdultFields"):
            for field in (
                "showSexExperience",
                "showSensitiveParts",
                "showGenitalStatus",
                "showEroticValue",
                "showPleasureValue",
                "showPublicKink",
                "showPrivateKink",
                "showSexualConception",
            ):
                content[field] = False
        if key in PROFILE_KEYS:
            content["apiUrl"] = HOST + "/profiles/" + PROFILE_KEYS[key]
            content["apiKey"] = "server-managed"
        if key == "CULTIVATION_KNOWLEDGE_SEARCH_API_CONFIG_V2":
            content.update(
                embeddingUrl=HOST + "/embeddings",
                embeddingKey="server-managed",
                vectorProvider="api",
                rerankUrl=HOST + "/rerank",
                rerankKey="server-managed",
                vectorSaveApiUrl=HOST + "/profiles/archive",
                vectorSaveApiKey="server-managed",
                # The pre-turn keyword analysis takes the quick route (low effort, short limit).
                vectorSearchApiUrl=HOST + "/profiles/archive-search",
                vectorSearchApiKey="server-managed",
            )
        if key == "CULTIVATION_CLOUD_STORAGE_CONFIG_V1":
            content.update(enabled=False, autoSync=False, apiUrl="")
    return result
