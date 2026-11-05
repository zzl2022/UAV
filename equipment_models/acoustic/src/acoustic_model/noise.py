"""Energy addition for mutually incoherent noise in the same band."""
from math import log10
from .inputs import level


def sum_noise_db(levels):
    """None/empty => unknown; 0 dB is a finite level, never silence.

    Caller must establish matching frequency band, time interval, reference
    pressure and weighting. The model checks band and weighting before calling.
    """
    values = list(levels)
    for value in values:
        level(value)
    if not values or any(value is None for value in values):
        return None
    peak = max(values)
    return peak + 10*log10(sum(10**((value-peak)/10) for value in values))
