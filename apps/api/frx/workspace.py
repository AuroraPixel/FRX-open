"""The objects a request works with, all bound to the user it acts for."""

from dataclasses import dataclass

from .auth import User
from .card_media import CardMedia
from .card_store import CardStore


@dataclass(frozen=True)
class Workspace:
    user: User
    records: CardStore
    media: CardMedia


def open_workspace(user, sessions):
    """The user's store and pictures over the shared database.

    The user's limits (multi-user mode) bound the pictures they keep, the number of saves and
    the size of one save; local mode has none.
    """
    limits = user.limits
    media = CardMedia(user.id, sessions, quota=limits.image_bytes if limits else None)
    records = CardStore(user.id, sessions, media=media, limits=limits)
    return Workspace(user=user, records=records, media=media)
