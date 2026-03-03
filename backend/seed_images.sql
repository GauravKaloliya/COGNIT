-- =====================================================================
-- C.O.G.N.I.T. Image + Attention Seed
-- Compatible with current backend schema and attention logic
-- Safe to run multiple times (idempotent upserts)
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- Images
-- ---------------------------------------------------------------------
INSERT INTO images (image_id, url, difficulty, object_count, width, height)
VALUES
    ('survey/attention-circle.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/attention-circle.svg', 5.0, 1, 800, 600),
    ('survey/attention-ocean.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/attention-ocean.svg', 5.0, 1, 800, 600),
    ('survey/attention-red.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/attention-red.svg', 5.0, 1, 800, 600),
    ('survey/aurora-lake.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/aurora-lake.svg', 5.0, 1, 800, 600),
    ('survey/bunny-garden.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/bunny-garden.svg', 5.0, 1, 800, 600),
    ('survey/cat-play.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/cat-play.svg', 5.0, 1, 800, 600),
    ('survey/coral-reef.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/coral-reef.svg', 5.0, 1, 800, 600),
    ('survey/cute-alpaca.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/cute-alpaca.svg', 5.0, 1, 800, 600),
    ('survey/cute-bear.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/cute-bear.svg', 5.0, 1, 800, 600),
    ('survey/cute-bunny.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/cute-bunny.svg', 5.0, 1, 800, 600),
    ('survey/cute-calf.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/cute-calf.svg', 5.0, 1, 800, 600),
    ('survey/cute-chick.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/cute-chick.svg', 5.0, 1, 800, 600),
    ('survey/cute-deer.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/cute-deer.svg', 5.0, 1, 800, 600),
    ('survey/cute-dolphin.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/cute-dolphin.svg', 5.0, 1, 800, 600),
    ('survey/cute-duck.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/cute-duck.svg', 5.0, 1, 800, 600),
    ('survey/cute-elephant.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/cute-elephant.svg', 5.0, 1, 800, 600),
    ('survey/cute-fox.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/cute-fox.svg', 5.0, 1, 800, 600),
    ('survey/cute-frog.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/cute-frog.svg', 5.0, 1, 800, 600),
    ('survey/cute-giraffe.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/cute-giraffe.svg', 5.0, 1, 800, 600),
    ('survey/cute-hedgehog.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/cute-hedgehog.svg', 5.0, 1, 800, 600),
    ('survey/cute-kitten.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/cute-kitten.svg', 5.0, 1, 800, 600),
    ('survey/cute-koala.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/cute-koala.svg', 5.0, 1, 800, 600),
    ('survey/cute-lamb.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/cute-lamb.svg', 5.0, 1, 800, 600),
    ('survey/cute-lion.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/cute-lion.svg', 5.0, 1, 800, 600),
    ('survey/cute-otter.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/cute-otter.svg', 5.0, 1, 800, 600),
    ('survey/cute-owl.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/cute-owl.svg', 5.0, 1, 800, 600),
    ('survey/cute-panda.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/cute-panda.svg', 5.0, 1, 800, 600),
    ('survey/cute-penguin.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/cute-penguin.svg', 5.0, 1, 800, 600),
    ('survey/cute-piglet.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/cute-piglet.svg', 5.0, 1, 800, 600),
    ('survey/cute-puppy.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/cute-puppy.svg', 5.0, 1, 800, 600),
    ('survey/cute-raccoon.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/cute-raccoon.svg', 5.0, 1, 800, 600),
    ('survey/cute-seal.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/cute-seal.svg', 5.0, 1, 800, 600),
    ('survey/cute-sloth.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/cute-sloth.svg', 5.0, 1, 800, 600),
    ('survey/cute-squirrel.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/cute-squirrel.svg', 5.0, 1, 800, 600),
    ('survey/cute-tiger.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/cute-tiger.svg', 5.0, 1, 800, 600),
    ('survey/cute-turtle.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/cute-turtle.svg', 5.0, 1, 800, 600),
    ('survey/cute-unicorn.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/cute-unicorn.svg', 5.0, 1, 800, 600),
    ('survey/desert-dunes.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/desert-dunes.svg', 5.0, 1, 800, 600),
    ('survey/dog-sunny.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/dog-sunny.svg', 5.0, 1, 800, 600),
    ('survey/forest-stream.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/forest-stream.svg', 5.0, 1, 800, 600),
    ('survey/fox-cloud.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/fox-cloud.svg', 5.0, 1, 800, 600),
    ('survey/glacier-bay.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/glacier-bay.svg', 5.0, 1, 800, 600),
    ('survey/golden-temple.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/golden-temple.svg', 5.0, 1, 800, 600),
    ('survey/hamster-wheel.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/hamster-wheel.svg', 5.0, 1, 800, 600),
    ('survey/harbor-dawn.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/harbor-dawn.svg', 5.0, 1, 800, 600),
    ('survey/kitten-yarn.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/kitten-yarn.svg', 5.0, 1, 800, 600),
    ('survey/lavender-fields.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/lavender-fields.svg', 5.0, 1, 800, 600),
    ('survey/midnight-city.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/midnight-city.svg', 5.0, 1, 800, 600),
    ('survey/misty-valley.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/misty-valley.svg', 5.0, 1, 800, 600),
    ('survey/moonlit-meadow.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/moonlit-meadow.svg', 5.0, 1, 800, 600),
    ('survey/northern-peaks.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/northern-peaks.svg', 5.0, 1, 800, 600),
    ('survey/orchid-garden.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/orchid-garden.svg', 5.0, 1, 800, 600),
    ('survey/puppy-ball.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/puppy-ball.svg', 5.0, 1, 800, 600),
    ('survey/rainbow-cliff.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/rainbow-cliff.svg', 5.0, 1, 800, 600),
    ('survey/redwood-survey.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/redwood-survey.svg', 5.0, 1, 800, 600),
    ('survey/river-canyon.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/river-canyon.svg', 5.0, 1, 800, 600),
    ('survey/rolling-hills.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/rolling-hills.svg', 5.0, 1, 800, 600),
    ('survey/rose-castle.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/rose-castle.svg', 5.0, 1, 800, 600),
    ('survey/saffron-market.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/saffron-market.svg', 5.0, 1, 800, 600),
    ('survey/sample-normal.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/sample-normal.svg', 5.0, 1, 800, 600),
    ('survey/sapphire-falls.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/sapphire-falls.svg', 5.0, 1, 800, 600),
    ('survey/savanna-sunset.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/savanna-sunset.svg', 5.0, 1, 800, 600),
    ('survey/sea-arch.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/sea-arch.svg', 5.0, 1, 800, 600),
    ('survey/serene-pond.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/serene-pond.svg', 5.0, 1, 800, 600),
    ('survey/silk-road.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/silk-road.svg', 5.0, 1, 800, 600),
    ('survey/silver-bridge.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/silver-bridge.svg', 5.0, 1, 800, 600),
    ('survey/starry-dunes.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/starry-dunes.svg', 5.0, 1, 800, 600),
    ('survey/sunlit-bay.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/sunlit-bay.svg', 5.0, 1, 800, 600),
    ('survey/tropical-lagoon.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/tropical-lagoon.svg', 5.0, 1, 800, 600),
    ('survey/violet-harbor.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/violet-harbor.svg', 5.0, 1, 800, 600),
    ('survey/whispering-glade.svg', 'https://cognitapi.s3.us-east-1.amazonaws.com/survey/whispering-glade.svg', 5.0, 1, 800, 600)
ON CONFLICT (image_id) DO UPDATE SET
    url          = EXCLUDED.url,
    difficulty   = EXCLUDED.difficulty,
    object_count = EXCLUDED.object_count,
    width        = EXCLUDED.width,
    height       = EXCLUDED.height;

-- ---------------------------------------------------------------------
-- Attention checks
-- NOTE: expected_word supports multi-terms (e.g. "circle|round")
-- with current backend parsing logic.
-- ---------------------------------------------------------------------

INSERT INTO attention_checks (image_id, expected_word, is_strict, is_active)
SELECT id, 'circle|round', true, true FROM images WHERE image_id = 'survey/attention-circle.svg'
ON CONFLICT (image_id) WHERE is_active = true DO UPDATE SET
    expected_word = EXCLUDED.expected_word,
    is_strict     = EXCLUDED.is_strict,
    is_active     = EXCLUDED.is_active;

INSERT INTO attention_checks (image_id, expected_word, is_strict, is_active)
SELECT id, 'ocean|sea', true, true FROM images WHERE image_id = 'survey/attention-ocean.svg'
ON CONFLICT (image_id) WHERE is_active = true DO UPDATE SET
    expected_word = EXCLUDED.expected_word,
    is_strict     = EXCLUDED.is_strict,
    is_active     = EXCLUDED.is_active;

INSERT INTO attention_checks (image_id, expected_word, is_strict, is_active)
SELECT id, 'red|crimson', true, true FROM images WHERE image_id = 'survey/attention-red.svg'
ON CONFLICT (image_id) WHERE is_active = true DO UPDATE SET
    expected_word = EXCLUDED.expected_word,
    is_strict     = EXCLUDED.is_strict,
    is_active     = EXCLUDED.is_active;

COMMIT;
