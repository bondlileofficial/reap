update public.tasks
set title = case sort_order
      when 1 then 'Blue Sky Sunset Quote Video'
      when 2 then 'Brown and White Simple Nature Video'
      when 3 then 'Orange and Black Illustrated Sunset Movie Credit Title Video'
      else title
    end,
    video_url = case sort_order
      when 1 then '/task%20videos/Blue%20Sky%20Sunset%20Quote%20Video%20.mp4'
      when 2 then '/task%20videos/Brown%20and%20White%20Simple%20Nature%20Video.mp4'
      when 3 then '/task%20videos/Orange%20and%20Black%20Illustrated%20Sunset%20Movie%20Credit%20Title%20Video.mp4'
      else video_url
    end
where video_url in (
  '/task%20videos/12248500_1920_1080_30fps.mp4',
  '/task%20videos/13649040_1920_1080_30fps.mp4',
  '/task%20videos/15257423_1920_1080_60fps.mp4'
);
