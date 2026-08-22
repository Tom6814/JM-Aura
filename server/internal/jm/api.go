package jm

import (
	"bytes"
	"context"
	"encoding/json"
	"net/url"
	"strconv"
)

func (c *Client) Setting(ctx context.Context, cookies map[string]string) (map[string]string, error) {
	res, err := c.APIGet(ctx, "/setting", nil, cookies)
	if err != nil {
		return nil, err
	}
	captured := CaptureSetCookies(res.Header)
	var payload struct {
		Cookies    map[string]string `json:"cookies"`
		JM3Version string            `json:"jm3_version"`
	}
	if jerr := json.Unmarshal(res.Data, &payload); jerr == nil {
		for k, v := range payload.Cookies {
			if v != "" {
				captured[k] = v
			}
		}
	}
	return captured, nil
}

func (c *Client) Login(ctx context.Context, username, password string) (*LoginResult, map[string]string, map[string]any, error) {
	form := url.Values{}
	form.Set("username", username)
	form.Set("password", password)
	res, err := c.APIPost(ctx, "/login", form, nil)
	if err != nil {
		return nil, nil, nil, err
	}
	var lr LoginResult
	if jerr := json.Unmarshal(res.Data, &lr); jerr != nil {
		return nil, nil, nil, jerr
	}
	rawMap := map[string]any{}
	dec := json.NewDecoder(bytes.NewReader(res.Data))
	dec.UseNumber()
	_ = dec.Decode(&rawMap)
	captured := CaptureSetCookies(res.Header)
	if lr.S != "" {
		captured["AVS"] = lr.S
	}
	return &lr, captured, rawMap, nil
}

func (c *Client) Signup(ctx context.Context, username, password, email, verification, gender string, cookies map[string]string) ([]byte, error) {
	form := url.Values{}
	form.Set("username", username)
	form.Set("email", email)
	form.Set("password", password)
	form.Set("password_confirm", password)
	form.Set("verification", verification)
	form.Set("gender", gender)
	form.Set("age", "on")
	form.Set("terms", "on")
	form.Set("submit_signup", "")
	return c.PostWebForm(ctx, "/signup", form, cookies)
}

func (c *Client) Album(ctx context.Context, albumID string, cookies map[string]string) (*AlbumData, map[string]any, error) {
	q := url.Values{}
	q.Set("id", albumID)
	res, err := c.APIGet(ctx, "/album", q, cookies)
	if err != nil {
		return nil, nil, err
	}
	var ad AlbumData
	if jerr := json.Unmarshal(res.Data, &ad); jerr != nil {
		return nil, nil, jerr
	}
	raw := map[string]any{}
	dec := json.NewDecoder(bytes.NewReader(res.Data))
	dec.UseNumber()
	if jerr := dec.Decode(&raw); jerr != nil {
		return &ad, nil, jerr
	}
	return &ad, raw, nil
}

func (c *Client) Chapter(ctx context.Context, chapterID string, cookies map[string]string) (*PhotoData, error) {
	q := url.Values{}
	q.Set("id", chapterID)
	res, err := c.APIGet(ctx, "/chapter", q, cookies)
	if err != nil {
		return nil, err
	}
	var pd PhotoData
	if jerr := json.Unmarshal(res.Data, &pd); jerr != nil {
		return nil, jerr
	}
	return &pd, nil
}

func (c *Client) Search(ctx context.Context, mainTag, query string, page int, order, sort string, cookies map[string]string) (*SearchPage, error) {
	q := url.Values{}
	q.Set("main_tag", mainTag)
	q.Set("search_query", query)
	q.Set("page", strconv.Itoa(page))
	q.Set("o", order)
	if sort != "" {
		q.Set("t", sort)
	}
	res, err := c.APIGet(ctx, "/search", q, cookies)
	if err != nil {
		return nil, err
	}
	var sp SearchPage
	if jerr := json.Unmarshal(res.Data, &sp); jerr != nil {
		return nil, jerr
	}
	return &sp, nil
}

// CategoriesFilter: o = "{order}_{time}" unless time is "" (TIME_ALL).
func (c *Client) CategoriesFilter(ctx context.Context, page int, category, timeOpt, orderBy string, cookies map[string]string) (*CallResult, error) {
	o := orderBy
	if timeOpt != "" && timeOpt != "a" {
		o = orderBy + "_" + timeOpt
	}
	q := url.Values{}
	q.Set("page", strconv.Itoa(page))
	q.Set("order", "")
	q.Set("c", category)
	q.Set("o", o)
	return c.APIGet(ctx, "/categories/filter", q, cookies)
}

func (c *Client) Categories(ctx context.Context, cookies map[string]string) (*CallResult, error) {
	return c.APIGet(ctx, "/categories", nil, cookies)
}

func (c *Client) Promote(ctx context.Context, page string, cookies map[string]string) (*CallResult, error) {
	q := url.Values{}
	q.Set("page", page)
	return c.APIGet(ctx, "/promote", q, cookies)
}

func (c *Client) Favorite(ctx context.Context, page int, folderID, orderBy string, cookies map[string]string) (*FavoritePage, error) {
	q := url.Values{}
	q.Set("page", strconv.Itoa(page))
	q.Set("folder_id", folderID)
	q.Set("o", orderBy)
	res, err := c.APIGet(ctx, "/favorite", q, cookies)
	if err != nil {
		return nil, err
	}
	var fp FavoritePage
	if jerr := json.Unmarshal(res.Data, &fp); jerr != nil {
		return nil, jerr
	}
	return &fp, nil
}

func (c *Client) AddFavorite(ctx context.Context, albumID string, cookies map[string]string) (*CallResult, error) {
	form := url.Values{}
	form.Set("aid", albumID)
	return c.APIPost(ctx, "/favorite", form, cookies)
}

// FavoriteFolderOp: type in {add, del, rename, move}; add/rename need folder_name, del/move use folder_id.
func (c *Client) FavoriteFolderOp(ctx context.Context, opType, folderID, folderName, albumID string, cookies map[string]string) (*CallResult, error) {
	form := url.Values{}
	form.Set("type", opType)
	if folderID != "" {
		form.Set("folder_id", folderID)
	}
	if folderName != "" {
		form.Set("folder_name", folderName)
	}
	if albumID != "" {
		form.Set("aid", albumID)
	}
	return c.APIPost(ctx, "/favorite_folder", form, cookies)
}

func ForumQuery(mode, aid, uid, bid string, page int) url.Values {
	q := url.Values{}
	q.Set("mode", mode)
	q.Set("page", strconv.Itoa(page))
	switch mode {
	case "uid":
		q.Set("uid", uid)
	case "bid":
		q.Set("bid", bid)
	default:
		if aid != "" {
			q.Set("aid", aid)
		}
	}
	return q
}

func (c *Client) Comments(ctx context.Context, mode, aid, uid, bid string, page int, cookies map[string]string) (*CommentPage, error) {
	res, err := c.APIGet(ctx, "/forum", ForumQuery(mode, aid, uid, bid, page), cookies)
	if err != nil {
		return nil, err
	}
	var cp CommentPage
	if jerr := json.Unmarshal(res.Data, &cp); jerr != nil {
		return nil, jerr
	}
	return &cp, nil
}

func (c *Client) SendComment(ctx context.Context, albumID, content, parentCID string, cookies map[string]string) (*CallResult, error) {
	form := url.Values{}
	form.Set("comment", content)
	form.Set("aid", albumID)
	if parentCID != "" && parentCID != "0" {
		form.Set("comment_id", parentCID)
	}
	return c.APIPost(ctx, "/comment", form, cookies)
}

func (c *Client) LikeComment(ctx context.Context, cid string, cookies map[string]string) (*CallResult, error) {
	form := url.Values{}
	form.Set("cid", cid)
	return c.APIPost(ctx, "/comment/like", form, cookies)
}

func (c *Client) WatchList(ctx context.Context, page int, cookies map[string]string) (*CallResult, error) {
	q := url.Values{}
	q.Set("page", strconv.Itoa(page))
	return c.APIGet(ctx, "/watch_list", q, cookies)
}

func (c *Client) Daily(ctx context.Context, userID string, cookies map[string]string) (*CallResult, error) {
	q := url.Values{}
	q.Set("user_id", userID)
	return c.APIGet(ctx, "/daily", q, cookies)
}

func (c *Client) DailyCheckIn(ctx context.Context, userID, dailyID string, cookies map[string]string) (*CallResult, error) {
	form := url.Values{}
	form.Set("user_id", userID)
	form.Set("daily_id", dailyID)
	return c.APIPost(ctx, "/daily_chk", form, cookies)
}

func (c *Client) Week(ctx context.Context, page int, cookies map[string]string) (*CallResult, error) {
	q := url.Values{}
	q.Set("page", strconv.Itoa(page))
	return c.APIGet(ctx, "/week", q, cookies)
}

func (c *Client) WeekFilter(ctx context.Context, page int, id, typ string, cookies map[string]string) (*CallResult, error) {
	q := url.Values{}
	q.Set("page", strconv.Itoa(page))
	q.Set("id", id)
	q.Set("type", typ)
	return c.APIGet(ctx, "/week/filter", q, cookies)
}

func (c *Client) Blogs(ctx context.Context, blogType string, page int, searchQuery string, cookies map[string]string) (*CallResult, error) {
	q := url.Values{}
	if blogType != "" {
		q.Set("blog_type", blogType)
	}
	q.Set("page", strconv.Itoa(page))
	if searchQuery != "" {
		q.Set("search_query", searchQuery)
	}
	return c.APIGet(ctx, "/blogs", q, cookies)
}

func (c *Client) Blog(ctx context.Context, blogID string, cookies map[string]string) (*CallResult, error) {
	q := url.Values{}
	q.Set("id", blogID)
	return c.APIGet(ctx, "/blog", q, cookies)
}

func (c *Client) CoinBuyComics(ctx context.Context, id string, cookies map[string]string) (*CallResult, error) {
	form := url.Values{}
	form.Set("id", id)
	return c.APIPost(ctx, "/coin_buy_comics", form, cookies)
}
